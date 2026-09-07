import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { reanchor } from "../skills/jstack-doc-review/src/anchors.js";
import { unifiedDiff } from "../skills/jstack-doc-review/src/diff.js";
import { startServer } from "../skills/jstack-doc-review/src/server.js";
import { sourceOffsetForMappedText, sourceTextForRange } from "../skills/jstack-doc-review/web/selection.js";
import { renderMarkdown } from "../skills/jstack-doc-review/web/markdown.js";
import { findLatestMarkdown, resolveDocument } from "../skills/jstack-doc-review/src/document.js";
import { ANCHOR_GAP, anchorLayout, anchorLayoutHeight, anchorLeadIn, anchorOpeningScroll } from "../skills/jstack-doc-review/web/anchor-layout.js";

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
test("keeps comments on their anchor line when they do not overlap",()=>{
  const comments=[{id:"a",target:0,height:60},{id:"b",target:200,height:60},{id:"c",target:400,height:60}];
  const tops=anchorLayout(comments,{activeId:"b",gap:12});
  assert.deepEqual(tops,[0,200,400]);
  assert.equal(anchorLayoutHeight(comments,tops),460);
});
test("keeps the active comment on its anchor and pushes the overlapping ones away",()=>{
  const comments=[{id:"a",target:100,height:60},{id:"b",target:120,height:60},{id:"c",target:140,height:60}];
  assert.deepEqual(anchorLayout(comments,{activeId:"b",gap:12}),[48,120,192]);
});
test("keeps every comment visible without overlap in anchor order",()=>{
  const comments=[{id:"a",target:300,height:80},{id:"b",target:310,height:40},{id:"c",target:320,height:100}];
  const tops=anchorLayout(comments,{activeId:"c",gap:12});
  assert.deepEqual(tops,[176,268,320]);
  tops.forEach((top,index)=>{if(index)assert.ok(top>=tops[index-1]+comments[index-1].height+12)});
});
test("stacks comments from the top when none is active",()=>{
  const comments=[{id:"a",target:0,height:60},{id:"b",target:10,height:60},{id:"c",target:500,height:60}];
  assert.deepEqual(anchorLayout(comments,{gap:12}),[0,72,500]);
  assert.deepEqual(anchorLayout(comments,{activeId:"document-wide",gap:12}),anchorLayout(comments,{gap:12}));
});
test("reports how far above its top the column reaches, and holds it there when told to",()=>{
  // Asked without a floor, a comment anchored above the top of the column says so — that is what the
  // caller reads to know how much further the document has to be led in.
  const comments=[{id:"a",target:-120,height:60},{id:"b",target:400,height:60}];
  assert.deepEqual(anchorLayout(comments,{gap:12}),[-120,400]);
  assert.deepEqual(anchorLayout(comments,{activeId:"a",gap:12}),[-120,400]);
  // Held to its top, it settles for as close as it can get and the one below keeps its own line.
  assert.deepEqual(anchorLayout(comments,{gap:12,floor:0}),[0,400]);
});
test("falls back to the shared gap when the caller does not name one",()=>{
  const comments=[{id:"a",target:0,height:60},{id:"b",target:10,height:60}];
  assert.deepEqual(anchorLayout(comments),[0,60+ANCHOR_GAP]);
});
test("leads the document in only as far as the column reaches above its top",()=>{
  // Nothing above the top of the column: the document keeps the padding its stylesheet asks for.
  assert.equal(anchorLeadIn({leadIn:12,tops:[300,600],basePadding:12}),12);
  // 88px above it: the first line moves down by exactly that much, and no further.
  assert.equal(anchorLeadIn({leadIn:12,tops:[-88,120],basePadding:12}),100);
  assert.equal(anchorLeadIn({leadIn:12,tops:[],basePadding:12}),12);
});
test("opens the page past a lead-in tall enough to hide the document",()=>{
  // Room to spare: the page opens where it loaded, with the rail head in view.
  assert.equal(anchorOpeningScroll({firstLineTop:572,height:900,visible:225,leadIn:460,basePadding:12}),0);
  // The document would be a sliver at the bottom, so the page opens past the lead-in instead and the
  // first line lands where it sits without one.
  assert.equal(anchorOpeningScroll({firstLineTop:884,height:900,visible:225,leadIn:772,basePadding:12}),760);
  assert.equal(anchorOpeningScroll({firstLineTop:124,height:900,visible:225,leadIn:12,basePadding:12}),0);
});
test("hands the room back no faster than the page can be scrolled down again",()=>{
  // 500px of lead-in is no longer needed, and the reader is far enough down to give all of it back.
  assert.equal(anchorLeadIn({leadIn:512,tops:[500,900],basePadding:12,room:900}),12);
  // Near the top of the page there is nowhere to scroll to, so the room is held on to instead.
  assert.equal(anchorLeadIn({leadIn:512,tops:[500,900],basePadding:12,room:100}),412);
  assert.equal(anchorLeadIn({leadIn:512,tops:[500,900],basePadding:12,room:0}),512);
  // Taking room is never held back — the page can always be scrolled further down.
  assert.equal(anchorLeadIn({leadIn:12,tops:[-88,120],basePadding:12,room:0}),100);
});
// The geometry of the whole placement, as the page applies it: the rail pins a head of some height
// above the column, a comment sits some way into the document, and the lead-in is what puts the two
// coordinate systems together. `position` is where the comment ends up, `line` is where its line ends
// up, and the criteria are about the two being equal.
function placeComments(railHead, comments, activeId, basePadding = 12) {
  const target = (leadIn, comment) => leadIn - railHead + comment.offset;
  const lay = (leadIn, floor) => anchorLayout(comments.map(comment => ({ ...comment, target: target(leadIn, comment) })), { activeId, floor });
  let leadIn = basePadding, tops = [];
  for (let pass = 0; pass < 2; pass++) {
    leadIn = anchorLeadIn({ leadIn, tops: lay(leadIn), basePadding });
    tops = lay(leadIn, 0);
  }
  return { leadIn, placed: comments.map((comment, index) => ({ id: comment.id, position: tops[index], line: target(leadIn, comment) })) };
}
test("puts the active comment on its own line however tall the pinned head is",()=>{
  // Three comments crowded into the first lines of the document: cards are ~199px, lines ~56px apart.
  const comments=[{id:"a",offset:0,height:199},{id:"b",offset:56,height:199},{id:"c",offset:112,height:199}];
  for (const railHead of [245, 460, 1412]) {
    for (const active of ["a","b","c"]) {
      const { leadIn, placed } = placeComments(railHead, comments, active);
      const chosen = placed.find(comment => comment.id === active);
      assert.equal(chosen.position, chosen.line, `active ${active} is off its line with a ${railHead}px head`);
      assert.ok(leadIn >= 12);
      placed.forEach((comment, index) => { if (index) assert.ok(comment.position >= placed[index-1].position + 199 + ANCHOR_GAP) });
    }
  }
});
test("lines a comment up with its line with nothing held on it",()=>{
  // Anchored above the top of the column, and no reader holding anything: the document is still led in
  // for it, because the column is where its line has to be read from.
  const comments=[{id:"a",offset:56,height:199},{id:"b",offset:900,height:199}];
  for (const railHead of [245, 1412]) {
    const { leadIn, placed } = placeComments(railHead, comments, null);
    assert.equal(leadIn, railHead - 56);
    assert.equal(placed[0].position, placed[0].line, `off its line with a ${railHead}px head`);
  }
});
test("leaves the document alone when every comment already has room",()=>{
  const comments=[{id:"a",offset:900,height:199},{id:"b",offset:1600,height:199}];
  for (const active of [null,"a","b"]) {
    const { leadIn, placed } = placeComments(245, comments, active);
    assert.equal(leadIn, 12, "the document is led in for comments that do not need it");
    placed.forEach(comment => assert.equal(comment.position, comment.line));
  }
});
test("serves every web module the page loads, and nothing else", async t => {
  const dir = await mkdtemp(join(tmpdir(), "jstack-doc-review-assets-test-")), file = join(dir, "doc.md");
  await writeFile(file, "# Doc\n");
  const app = await startServer({ documentPath: file, port: 0, openBrowser: false, dataDir: join(dir, "data") });
  t.after(() => app.close().catch(() => {}));
  // Follow the page to the modules it loads and each module to the ones it imports, so a module that
  // only ever arrives through an import is covered too.
  const page = await (await fetch(app.url)).text();
  const pending = [...page.matchAll(/(?:src|href)="(\/[^"]+)"/g)].map(match => match[1]), seen = new Set();
  assert.ok(pending.includes("/app.js"));
  while (pending.length) {
    const path = pending.pop();
    if (seen.has(path)) continue;
    seen.add(path);
    const response = await fetch(app.url + path);
    assert.equal(response.status, 200, `${path} is not served`);
    if (!path.endsWith(".js")) continue;
    const source = await response.text();
    for (const [, specifier] of source.matchAll(/from\s+"(\.[^"]+)"/g)) {
      pending.push(new URL(specifier, `http://localhost${path}`).pathname);
    }
  }
  assert.ok(seen.has("/anchor-layout.js") && seen.has("/vendor/marked.esm.js"), [...seen].join(" "));
  for (const path of ["/src/server.js", "/nope.js", "/app.js/", "/../src/server.js", "/%2e%2e/src/server.js", "/vendor/../../src/server.js"]) {
    assert.equal((await fetch(app.url + path)).status, 404, `${path} should not be served`);
  }
});
test("generates a unified diff",()=>{const d=unifiedDiff("a\nb","a\nc");assert.match(d,/^-b$/m);assert.match(d,/^\+c$/m)});
test("renders comment Markdown as headings, lists, code, and emphasis",()=>{
  const html=renderMarkdown("## Title\n\n- one\n- two\n\n`inline` and **strong**\n\n```js\nconst a = 1;\n```\n");
  assert.match(html,/<h2>Title<\/h2>/);
  assert.match(html,/<ul>\s*<li>one<\/li>/);
  assert.match(html,/<code>inline<\/code>/);
  assert.match(html,/<strong>strong<\/strong>/);
  assert.match(html,/<pre><code class="language-js">const a = 1;/);
});
test("keeps raw HTML in comments as text",()=>{
  const html=renderMarkdown('<img src=x onerror=alert(1)>\n\ninline <b>bold</b>\n');
  assert.doesNotMatch(html,/<img|<b>/);
  assert.match(html,/&lt;img src=x onerror=alert\(1\)&gt;/);
  assert.match(html,/&lt;b&gt;bold&lt;\/b&gt;/);
});
test("opens rendered links in a new tab and drops unsafe URLs",()=>{
  assert.match(renderMarkdown("[docs](https://example.com/a)"),/<a href="https:\/\/example\.com\/a" target="_blank" rel="noreferrer">docs<\/a>/);
  const unsafe=renderMarkdown("[click](javascript:alert(1)) and ![shot](javascript:alert(1))");
  assert.doesNotMatch(unsafe,/javascript:/);
  assert.match(unsafe,/click/);
});

async function postThread(url, comment) {
  return fetch(url + "/api/threads", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ anchor: { startLine: 1, endLine: 1, selectedText: "# Design" }, comment }) }).then(response => response.json());
}

// A single read can carry several events, so buffering has to survive across reads.
function sseEvents(reader) {
  const decoder = new TextDecoder();
  let buffer = "";
  const pending = [];
  return async function read(count) {
    while (pending.length < count) {
      const { value, done } = await reader.read();
      assert.equal(done, false);
      buffer += decoder.decode(value, { stream: true });
      const chunks = buffer.split("\n\n");
      buffer = chunks.pop();
      for (const chunk of chunks) {
        const event = chunk.match(/^event: ([^\n]+)\ndata: ([\s\S]+)$/);
        if (event) pending.push({ type: event[1], data: JSON.parse(event[2]) });
      }
    }
    return pending.splice(0, count);
  };
}

test("persists consecutive comments in the durable queue and delivers each once after reconnecting", async t => {
  const dir = await mkdtemp(join(tmpdir(), "jstack-doc-review-queue-test-")), file = join(dir, "design.md");
  await writeFile(file, "# Design\n");
  const app = await startServer({ documentPath: file, port: 0, openBrowser: false, dataDir: join(dir, "data") });
  t.after(() => app.close().catch(() => {}));
  const initialResponse = await fetch(app.url + "/api/agent-events"), initialReader = initialResponse.body.getReader();
  await sseEvents(initialReader)(1);
  await initialReader.cancel();
  const first = await postThread(app.url, "First comment");
  const second = await postThread(app.url, "Second comment");
  assert.equal(first.messages[0].agentStatus, "received");
  assert.equal(second.messages[0].agentStatus, "received");
  const response = await fetch(app.url + "/api/agent-events"), reader = response.body.getReader();
  const events = await sseEvents(reader)(3);
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

test("document conversation API persists, restores, and finishes",async t=>{
  const dir=await mkdtemp(join(tmpdir(),"jstack-doc-review-test-")),file=join(dir,"design.md");await writeFile(file,"# Design\n\nImportant choice.\nA second line.\n");
  const app=await startServer({documentPath:file,port:0,openBrowser:false,dataDir:join(dir,"data")});t.after(()=>app.close().catch(()=>{}));
  let state=await fetch(app.url+"/api/state").then(r=>r.json());assert.equal(state.revision.number,1);
  const eventResponse=await fetch(app.url+"/api/agent-events"),eventReader=eventResponse.body.getReader(),readEvents=sseEvents(eventReader);await readEvents(1);
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
  const [pushed,multilinePushed]=await readEvents(2);
  assert.deepEqual([pushed.type,pushed.data.messageId],["feedback",thread.messages[0].id]);
  assert.deepEqual([multilinePushed.type,multilinePushed.data.messageId],["feedback",multilineThread.messages[0].id]);
  const documentThread=await fetch(app.url+"/api/threads",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({anchor:{type:"document"},comment:"Please check the entire document"})}).then(r=>r.json());
  assert.deepEqual(documentThread.anchor,{type:"document"});
  const [documentPushed]=await readEvents(1);
  assert.deepEqual([documentPushed.type,documentPushed.data.messageId],["feedback",documentThread.messages[0].id]);
  const documentFeedback=await fetch(app.url+"/api/feedback").then(r=>r.json());
  const documentFeedbackThread=documentFeedback.threads.find(item=>item.id===documentThread.id);
  assert.equal(documentFeedbackThread.scope,"document");assert.equal(documentFeedbackThread.lineRange,null);assert.equal(documentFeedbackThread.surroundingContext,null);assert.equal(documentFeedbackThread.orphaned,false);
  await fetch(`${app.url}/api/threads/${documentThread.id}/messages`,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({author:"human",content:"Associate this reply with the entire document too"})});
  const [replyPushed]=await readEvents(1);
  assert.equal(replyPushed.type,"feedback");
  assert.ok(replyPushed.data.threads.find(item=>item.id===documentThread.id).messages.some(message=>message.content==="Associate this reply with the entire document too"));
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
