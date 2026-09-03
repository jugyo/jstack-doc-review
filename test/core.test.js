import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { reanchor } from "../src/anchors.js";
import { unifiedDiff } from "../src/diff.js";
import { startServer } from "../src/server.js";
import { sourceOffsetForMappedText, sourceTextForRange } from "../web/selection.js";
import { findLatestMarkdown, resolveDocument } from "../src/document.js";
import { resolveDataDir } from "../src/storage.js";

test("selects the most recently created Markdown when the path is omitted", async () => {
  const dir = await mkdtemp(join(tmpdir(), "jstack-doc-review-document-test-"));
  await mkdir(join(dir, "nested"));
  await writeFile(join(dir, "older.md"), "# Older\n");
  await new Promise(resolve => setTimeout(resolve, 10));
  await writeFile(join(dir, "nested", "newer.md"), "# Newer\n");
  assert.equal(await findLatestMarkdown(dir), join(dir, "nested", "newer.md"));
  assert.deepEqual(await resolveDocument({ cwd: dir }), { path: join(dir, "nested", "newer.md"), source: "latest-markdown" });
});

test("saves long text as a temporary Markdown when no Markdown exists", async () => {
  const dir = await mkdtemp(join(tmpdir(), "jstack-doc-review-text-test-")), textFile = join(dir, "context.txt");
  const content = "# Latest explanation\n\nThis content is preserved as written.\n";
  await writeFile(textFile, content);
  const document = await resolveDocument({ cwd: dir, textFile });
  assert.equal(document.source, "long-text");
  assert.equal(await readFile(document.path, "utf8"), content);
  assert.match(document.path, /jstack-doc-review-context-[^/]+\/context\.md$/);
});

test("requests input when no candidate or long text is available", async () => {
  const dir = await mkdtemp(join(tmpdir(), "jstack-doc-review-empty-test-"));
  await assert.rejects(() => resolveDocument({ cwd: dir }), /No Markdown review target found/);
});

test("prefers an explicit path over automatic selection", async () => {
  const dir = await mkdtemp(join(tmpdir(), "jstack-doc-review-explicit-test-")), file = join(dir, "chosen.md");
  await writeFile(file, "# Chosen\n");
  assert.deepEqual(await resolveDocument({ explicitPath: file, cwd: dir }), { path: file, source: "explicit" });
});

test("copies legacy review data to the new default directory without removing it", async t => {
  const home = await mkdtemp(join(tmpdir(), "jstack-doc-review-home-test-"));
  const legacyDir = join(home, ".jstack-md");
  const file = join(home, "legacy.md");
  await writeFile(file, "# Legacy\n");
  const legacyApp = await startServer({ documentPath: file, port: 0, openBrowser: false, dataDir: legacyDir });
  await legacyApp.close();
  const dataDir = await resolveDataDir({ home });
  assert.equal(dataDir, join(home, ".jstack-doc-review"));
  const app = await startServer({ documentPath: file, port: 0, openBrowser: false, homeDir: home });
  t.after(() => app.close().catch(() => {}));
  const state = await fetch(app.url + "/api/state").then(response => response.json());
  assert.equal(state.document.path, file);
  assert.equal(state.revision.number, 1);
  assert.equal(await readFile(join(legacyDir, "review.db"), "utf8"), await readFile(join(dataDir, "review.db"), "utf8"));
});

test("reanchors exact text after lines move",()=>{
  const anchor={startLine:2,endLine:2,selectedText:"important sentence",prefix:"title",suffix:"tail"};
  assert.equal(reanchor(anchor,"new\ntitle\nimportant sentence\ntail").startLine,3);
});
test("reanchors multiline selections without changing text",()=>{
  const selected="first line\nsecond line";
  const anchor={startLine:2,endLine:3,selectedText:selected,prefix:"Title",suffix:"After"};
  const moved=reanchor(anchor,"Title\nintro\nfirst line\nsecond line\nAfter");
  assert.deepEqual({startLine:moved.startLine,endLine:moved.endLine,selectedText:moved.selectedText},{startLine:3,endLine:4,selectedText:selected});
});
test("preserves whitespace around selected anchors",()=>{
  const selected=" first line\nsecond line ";
  const moved=reanchor({startLine:1,endLine:2,selectedText:selected,prefix:"",suffix:""},`before\n${selected}\nafter`);
  assert.equal(moved.selectedText,selected);
  assert.deepEqual([moved.startLine,moved.endLine],[2,3]);
});
test("reanchors line anchors without selected text using surrounding context",()=>{
  const anchor={startLine:2,endLine:2,selectedText:"",prefix:"Title",suffix:"Body"};
  const moved=reanchor(anchor,"Intro\nTitle\n\nBody");
  assert.deepEqual([moved.startLine,moved.endLine,moved.selectedText],[3,3,""]);
});
test("builds multiline selections from the source after display mapping",()=>{
  const sourceLines=["- first item","","## after"];
  assert.equal(sourceTextForRange(sourceLines,1,0,3,sourceLines[2].length),"- first item\n\n## after");
});
test("maps decorated text selection endpoints to the visible range",()=>{
  const link={sourceStart:0,sourceEnd:29,sourceTextStart:1,sourceTextEnd:7,visibleLength:6};
  const [start,end]=[sourceOffsetForMappedText(link,0),sourceOffsetForMappedText(link,6)];
  assert.deepEqual([start,end],[1,7]);
  assert.equal(sourceTextForRange(["[skills](https://skills.sh/)"],1,start,1,end),"skills");
});
test("reanchors selections containing blank lines across updates",()=>{
  const selected="before\n\nafter";
  const moved=reanchor({startLine:1,endLine:3,selectedText:selected,prefix:"",suffix:""},"intro\nbefore\n\nafter\nend");
  assert.deepEqual([moved.startLine,moved.endLine,moved.selectedText],[2,4,selected]);
});
test("marks impossible anchors as unresolved",()=>assert.equal(reanchor({startLine:1,endLine:1,selectedText:"gone",prefix:"",suffix:""},"entirely different"),null));
test("generates a unified diff",()=>{const d=unifiedDiff("a\nb","a\nc");assert.match(d,/^-b$/m);assert.match(d,/^\+c$/m)});

async function postThread(url, comment) {
  return fetch(url + "/api/threads", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ anchor: { startLine: 1, endLine: 1, selectedText: "# Design" }, comment }) }).then(response => response.json());
}

async function readSseEvents(reader, count) {
  const decoder = new TextDecoder();
  let buffer = "";
  const events = [];
  while (events.length < count) {
    const { value, done } = await reader.read();
    assert.equal(done, false);
    buffer += decoder.decode(value, { stream: true });
    const chunks = buffer.split("\n\n");
    buffer = chunks.pop();
    for (const chunk of chunks) {
      const event = chunk.match(/^event: ([^\n]+)\ndata: ([\s\S]+)$/);
      if (event) events.push({ type: event[1], data: JSON.parse(event[2]) });
    }
  }
  return events;
}

test("persists consecutive comments in the durable queue and delivers each once after reconnecting", async t => {
  const dir = await mkdtemp(join(tmpdir(), "jstack-doc-review-queue-test-")), file = join(dir, "design.md");
  await writeFile(file, "# Design\n");
  const app = await startServer({ documentPath: file, port: 0, openBrowser: false, dataDir: join(dir, "data") });
  t.after(() => app.close().catch(() => {}));
  const initialResponse = await fetch(app.url + "/api/agent-events"), initialReader = initialResponse.body.getReader();
  await readSseEvents(initialReader, 1);
  await initialReader.cancel();
  const first = await postThread(app.url, "First comment");
  const second = await postThread(app.url, "Second comment");
  assert.equal(first.messages[0].agentStatus, "received");
  assert.equal(second.messages[0].agentStatus, "received");
  const response = await fetch(app.url + "/api/agent-events"), reader = response.body.getReader();
  const events = await readSseEvents(reader, 3);
  assert.equal(events[0].type, "ready");
  assert.deepEqual(new Set(events.slice(1).map(event => event.data.messageId)), new Set([first.messages[0].id, second.messages[0].id]));
  await reader.cancel();
});

test("does not deliver events for another document in a shared data directory", async t => {
  const dir = await mkdtemp(join(tmpdir(), "jstack-doc-review-isolation-test-")), dataDir = join(dir, "data");
  const fileA = join(dir, "a.md"), fileB = join(dir, "b.md");
  await writeFile(fileA, "# A\n");
  await writeFile(fileB, "# B\n");
  const appA = await startServer({ documentPath: fileA, port: 0, openBrowser: false, dataDir });
  const appB = await startServer({ documentPath: fileB, port: 0, openBrowser: false, dataDir });
  t.after(() => Promise.all([appA.close().catch(() => {}), appB.close().catch(() => {})]));
  const threadA = await postThread(appA.url, "A-only comment");
  const foreignStatus = await fetch(`${appB.url}/api/threads/${threadA.id}/messages/${threadA.messages[0].id}/agent-status`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ status: "processing" }) });
  assert.equal(foreignStatus.status, 404);
  const foreignMessage = await fetch(`${appB.url}/api/threads/${threadA.id}/messages`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ author: "human", content: "Append to another document" }) });
  assert.equal(foreignMessage.status, 404);
  const response = await fetch(appB.url + "/api/agent-events"), reader = response.body.getReader();
  const decoder = new TextDecoder(), first = await reader.read();
  assert.match(decoder.decode(first.value), /event: ready/);
  const next = await Promise.race([reader.read(), new Promise(resolve => setTimeout(() => resolve({ timedOut: true }), 100))]);
  assert.equal(next.timedOut, true);
  await reader.cancel();
});

test("migrates existing human messages into the received queue", async t => {
  const dir = await mkdtemp(join(tmpdir(), "jstack-doc-review-message-migration-test-")), file = join(dir, "legacy.md"), dataDir = join(dir, "data");
  await writeFile(file, "# Legacy\n");
  await mkdir(dataDir);
  const legacy = new DatabaseSync(join(dataDir, "review.db"));
  legacy.exec(`
    CREATE TABLE documents(id TEXT PRIMARY KEY,path TEXT UNIQUE NOT NULL,current_revision_id TEXT);
    CREATE TABLE sessions(id TEXT PRIMARY KEY,document_id TEXT NOT NULL,status TEXT NOT NULL,started_at TEXT NOT NULL,completed_at TEXT,result TEXT,agent_binding TEXT);
    CREATE TABLE revisions(id TEXT PRIMARY KEY,document_id TEXT NOT NULL,number INTEGER NOT NULL,content TEXT NOT NULL,content_hash TEXT NOT NULL,created_at TEXT NOT NULL,reason TEXT,source_thread_ids TEXT NOT NULL DEFAULT '[]');
    CREATE TABLE threads(id TEXT PRIMARY KEY,document_id TEXT NOT NULL,anchor TEXT NOT NULL,status TEXT NOT NULL,orphaned INTEGER NOT NULL DEFAULT 0,created_at TEXT NOT NULL);
    CREATE TABLE messages(id TEXT PRIMARY KEY,thread_id TEXT NOT NULL,author TEXT NOT NULL,content TEXT NOT NULL,created_at TEXT NOT NULL);
  `);
  legacy.prepare("INSERT INTO documents VALUES(?,?,?)").run("legacy-doc",file,null);
  legacy.prepare("INSERT INTO threads VALUES(?,?,?,?,?,?)").run("legacy-thread","legacy-doc",JSON.stringify({startLine:1,endLine:1,selectedText:"# Legacy",prefix:"",suffix:""}),"open",0,"2026-01-01T00:00:00.000Z");
  legacy.prepare("INSERT INTO messages VALUES(?,?,?,?,?)").run("legacy-message","legacy-thread","human","Old comment","2026-01-01T00:00:01.000Z");
  legacy.close();
  const app = await startServer({ documentPath: file, port: 0, openBrowser: false, dataDir });
  t.after(() => app.close().catch(() => {}));
  const state = await fetch(app.url + "/api/state").then(response => response.json());
  assert.equal(state.threads[0].messages[0].agentStatus, "received");
  const response = await fetch(app.url + "/api/agent-events"), reader = response.body.getReader();
  const events = await readSseEvents(reader, 2);
  assert.equal(events[1].data.messageId, "legacy-message");
  await reader.cancel();
});

test("document conversation API persists, restores, and finishes",async t=>{
  const dir=await mkdtemp(join(tmpdir(),"jstack-doc-review-test-")),file=join(dir,"design.md");await writeFile(file,"# Design\n\nImportant choice.\nA second line.\n");
  const app=await startServer({documentPath:file,port:0,openBrowser:false,dataDir:join(dir,"data")});t.after(()=>app.close().catch(()=>{}));
  let state=await fetch(app.url+"/api/state").then(r=>r.json());assert.equal(state.revision.number,1);
  const eventResponse=await fetch(app.url+"/api/agent-events"),eventReader=eventResponse.body.getReader();await eventReader.read();
  const thread=await fetch(app.url+"/api/threads",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({anchor:{startLine:3,endLine:3,selectedText:"Important choice.",prefix:"# Design\n",suffix:""},comment:"Why?"})}).then(r=>r.json());assert.equal(thread.messages[0].content,"Why?");
  assert.equal(thread.messages[0].agentStatus,"received");
  const multiline="Important choice.\nA second line.";
  const multilineThread=await fetch(app.url+"/api/threads",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({anchor:{startLine:3,endLine:4,selectedText:multiline,prefix:"# Design\n",suffix:""},comment:"Please check both lines"})}).then(r=>r.json());
  assert.deepEqual({startLine:multilineThread.anchor.startLine,endLine:multilineThread.anchor.endLine,selectedText:multiline},{startLine:3,endLine:4,selectedText:multiline});
  const feedback=await fetch(app.url+"/api/feedback").then(r=>r.json());
  assert.equal(feedback.type,"document_feedback");
  const feedbackThread=feedback.threads.find(item=>item.id===multilineThread.id);
  assert.equal(feedbackThread.quote,multiline);
  assert.deepEqual(feedbackThread.lineRange,{start:3,end:4});
  const invalid=await fetch(app.url+"/api/threads",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({anchor:{startLine:999,endLine:999},comment:"Out of range"})});assert.equal(invalid.status,400);
  const pushed=new TextDecoder().decode((await eventReader.read()).value);assert.match(pushed,/event: feedback/);assert.match(pushed,/Why\?/);
  const multilinePushed=new TextDecoder().decode((await eventReader.read()).value);assert.match(multilinePushed,/event: feedback/);assert.match(multilinePushed,/Please check both lines/);
  const documentThread=await fetch(app.url+"/api/threads",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({anchor:{type:"document"},comment:"Please check the entire document"})}).then(r=>r.json());
  assert.deepEqual(documentThread.anchor,{type:"document"});
  const documentPushed=new TextDecoder().decode((await eventReader.read()).value);assert.match(documentPushed,/event: feedback/);assert.match(documentPushed,/Please check the entire document/);
  const documentFeedback=await fetch(app.url+"/api/feedback").then(r=>r.json());
  const documentFeedbackThread=documentFeedback.threads.find(item=>item.id===documentThread.id);
  assert.equal(documentFeedbackThread.scope,"document");assert.equal(documentFeedbackThread.lineRange,null);assert.equal(documentFeedbackThread.surroundingContext,null);assert.equal(documentFeedbackThread.orphaned,false);
  await fetch(`${app.url}/api/threads/${documentThread.id}/messages`,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({author:"human",content:"Associate this reply with the entire document too"})});
  const replyPushed=new TextDecoder().decode((await eventReader.read()).value);assert.match(replyPushed,/event: feedback/);assert.match(replyPushed,/Associate this reply with the entire document too/);
  const processing=await fetch(`${app.url}/api/threads/${thread.id}/messages/${thread.messages[0].id}/agent-status`,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({status:"processing"})}).then(r=>r.json());assert.equal(processing.agentStatus,"processing");
  const completed=await fetch(`${app.url}/api/threads/${thread.id}/messages/${thread.messages[0].id}/agent-status`,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({status:"completed"})}).then(r=>r.json());assert.equal(completed.agentStatus,"completed");
  await eventReader.cancel();
  const normalizedResponse=await fetch(app.url+"/api/threads",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({anchor:{startLine:2,endLine:2},comment:"Blank anchor"})});assert.equal(normalizedResponse.status,201);const normalizedThread=await normalizedResponse.json();assert.equal(normalizedThread.anchor.selectedText,"");
  await fetch(`${app.url}/api/threads/${thread.id}/messages`,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({author:"agent",content:"Because it is safer."})});
  await writeFile(file,"# Design\n\nA preface.\nImportant choice.\n");await new Promise(r=>setTimeout(r,350));state=await fetch(app.url+"/api/state").then(r=>r.json());assert.equal(state.revision.number,2);assert.equal(state.threads[0].anchor.startLine,4);
  const persistedDocumentThread=state.threads.find(item=>item.id===documentThread.id);assert.deepEqual(persistedDocumentThread.anchor,{type:"document"});assert.equal(persistedDocumentThread.orphaned,false);
  await fetch(`${app.url}/api/revisions/${state.revisions[0].id}/restore`,{method:"POST",headers:{"content-type":"application/json"},body:"{}"});assert.equal(await readFile(file,"utf8"),"# Design\n\nImportant choice.\nA second line.\n");
  const result=await fetch(app.url+"/api/finish",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({result:"ignored"})}).then(r=>r.json());assert.equal(result.result,"finished");assert.equal(result.threads[0].messages.length,2);assert.equal((await fetch(app.url+"/api/state").then(r=>r.json())).session.status,"finished");
});
