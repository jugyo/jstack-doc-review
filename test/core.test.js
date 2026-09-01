import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { reanchor } from "../src/anchors.js";
import { unifiedDiff } from "../src/diff.js";
import { startServer } from "../src/server.js";

test("reanchors exact text after lines move",()=>{
  const anchor={startLine:2,endLine:2,selectedText:"important sentence",prefix:"title",suffix:"tail"};
  assert.equal(reanchor(anchor,"new\ntitle\nimportant sentence\ntail").startLine,3);
});
test("marks impossible anchors as unresolved",()=>assert.equal(reanchor({startLine:1,endLine:1,selectedText:"gone",prefix:"",suffix:""},"entirely different"),null));
test("generates a unified diff",()=>{const d=unifiedDiff("a\nb","a\nc");assert.match(d,/^-b$/m);assert.match(d,/^\+c$/m)});

test("end-to-end review API persists, restores, and finishes",async t=>{
  const dir=await mkdtemp(join(tmpdir(),"jstack-md-test-")),file=join(dir,"design.md");await writeFile(file,"# Design\n\nImportant choice.\n");
  const app=await startServer({documentPath:file,port:0,openBrowser:false,dataDir:join(dir,"data")});t.after(()=>app.close().catch(()=>{}));
  let state=await fetch(app.url+"/api/state").then(r=>r.json());assert.equal(state.revision.number,1);
  const eventResponse=await fetch(app.url+"/api/agent-events"),eventReader=eventResponse.body.getReader();await eventReader.read();
  const thread=await fetch(app.url+"/api/threads",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({anchor:{startLine:3,endLine:3,selectedText:"Important choice.",prefix:"# Design\n",suffix:""},comment:"Why?"})}).then(r=>r.json());assert.equal(thread.messages[0].content,"Why?");
  const invalid=await fetch(app.url+"/api/threads",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({anchor:{startLine:999,endLine:999},comment:"Out of range"})});assert.equal(invalid.status,400);
  const pushed=new TextDecoder().decode((await eventReader.read()).value);assert.match(pushed,/event: feedback/);assert.match(pushed,/Why\?/);await eventReader.cancel();
  const normalizedResponse=await fetch(app.url+"/api/threads",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({anchor:{startLine:2,endLine:2},comment:"Blank anchor"})});assert.equal(normalizedResponse.status,201);const normalizedThread=await normalizedResponse.json();assert.equal(normalizedThread.anchor.selectedText,"");
  await fetch(`${app.url}/api/threads/${thread.id}/messages`,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({author:"agent",content:"Because it is safer."})});
  await writeFile(file,"# Design\n\nA preface.\nImportant choice.\n");await new Promise(r=>setTimeout(r,350));state=await fetch(app.url+"/api/state").then(r=>r.json());assert.equal(state.revision.number,2);assert.equal(state.threads[0].anchor.startLine,4);
  await fetch(`${app.url}/api/revisions/${state.revisions[0].id}/restore`,{method:"POST",headers:{"content-type":"application/json"},body:"{}"});assert.equal(await readFile(file,"utf8"),"# Design\n\nImportant choice.\n");
  const result=await fetch(app.url+"/api/finish",{method:"POST",headers:{"content-type":"application/json"},body:"{}"}).then(r=>r.json());assert.equal(result.result,"completed-with-open-threads");assert.equal(result.threads[0].messages.length,2);
});
