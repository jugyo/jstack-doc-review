import http from "node:http";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { watch } from "node:fs";
import { homedir } from "node:os";
import { join, basename } from "node:path";
import { execFile } from "node:child_process";
import { Store } from "./store.js";
import { contextFor, reanchor } from "./anchors.js";
import { unifiedDiff } from "./diff.js";

const mime={".js":"text/javascript; charset=utf-8",".css":"text/css; charset=utf-8",".html":"text/html; charset=utf-8"};
const send=(res,status,data,type="application/json; charset=utf-8")=>{res.writeHead(status,{"content-type":type,"cache-control":"no-store","x-content-type-options":"nosniff"});res.end(type.startsWith("application/json")?JSON.stringify(data):data);};
const body=async req=>{const chunks=[];for await(const c of req)chunks.push(c);if(Buffer.concat(chunks).length>1_000_000)throw new Error("Request too large");return JSON.parse(Buffer.concat(chunks).toString()||"{}");};

export async function startServer(options) {
  const content=await readFile(options.documentPath,"utf8");
  const dataDir=options.dataDir ?? join(homedir(),".jstack-md"); await mkdir(dataDir,{recursive:true,mode:0o700});
  const store=new Store(join(dataDir,"review.db"));
  const opened=store.open(options.documentPath,content,options.agentBinding); const clients=new Set(),agentClients=new Set(),agentDelivery=new Map();
  let latestContent=content, writing=false, debounce;
  let complete; const completion=new Promise(r=>complete=r);
  const broadcast=(event,payload={})=>{const msg=`event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`;for(const res of clients)res.write(msg);};
  const state=()=>({
    product:"jstack-md",document:{...opened.document,name:basename(options.documentPath),content:latestContent},session:opened.session,
    revision:store.revision(store.currentRevision(opened.document.id)),revisions:store.revisions(opened.document.id).map(({content,...r})=>r),threads:store.threads(opened.document.id),agentBinding:options.agentBinding
  });
  const capture=async(reason="Document changed",sourceThreadIds=[])=>{
    const next=await readFile(options.documentPath,"utf8"); if(next===latestContent)return;
    latestContent=next; const revision=store.addRevision(opened.document.id,next,reason,sourceThreadIds);
    for(const thread of store.threads(opened.document.id)){const anchor=reanchor(thread.anchor,next);store.updateAnchor(thread.id,anchor??thread.anchor,!anchor);}
    broadcast("revision",{revision});
  };
  const watcher=watch(options.documentPath,()=>{if(writing)return;clearTimeout(debounce);debounce=setTimeout(()=>capture().catch(console.error),180);});

  const server=http.createServer(async(req,res)=>{
    try {
      const url=new URL(req.url,"http://localhost");
      if(req.method==="GET"&&url.pathname==="/")return send(res,200,await readFile(new URL("../web/index.html",import.meta.url),"utf8"),mime[".html"]);
      if(req.method==="GET"&&["/app.js","/selection.js","/style.css","/agent.css","/history.css"].includes(url.pathname))return send(res,200,await readFile(new URL(`../web${url.pathname}`,import.meta.url),"utf8"),mime[url.pathname.slice(url.pathname.lastIndexOf("."))]);
      if(req.method==="GET"&&url.pathname==="/api/state")return send(res,200,state());
      if(req.method==="GET"&&url.pathname==="/events"){
        res.writeHead(200,{"content-type":"text/event-stream","cache-control":"no-cache","connection":"keep-alive"});res.write("event: connected\ndata: {}\n\n");clients.add(res);req.on("close",()=>clients.delete(res));return;
      }
      if(req.method==="GET"&&url.pathname==="/api/agent-events"){
        res.writeHead(200,{"content-type":"text/event-stream","cache-control":"no-cache","connection":"keep-alive","x-accel-buffering":"no"});
        res.write(`event: ready\ndata: ${JSON.stringify({sessionId:opened.session.id})}\n\n`);agentClients.add(res);agentDelivery.set(res,new Set());
        for(const event of store.agentEvents(opened.document.id)) sendAgentEvent(res,event);
        req.on("close",()=>{agentClients.delete(res);agentDelivery.delete(res);});return;
      }
      if(req.method==="POST"&&url.pathname==="/api/threads"){
        const data=await body(req),lineCount=latestContent.split("\n").length; if(!data.comment?.trim()||!Number.isInteger(data.anchor?.startLine)||!Number.isInteger(data.anchor?.endLine)||data.anchor.startLine<1||data.anchor.endLine<data.anchor.startLine||data.anchor.endLine>lineCount)return send(res,400,{error:"A valid line range within the document and comment are required"});
        const context=contextFor(latestContent.split("\n"),data.anchor.startLine,data.anchor.endLine);
        const anchor={...data.anchor,selectedText:typeof data.anchor.selectedText==="string"?data.anchor.selectedText:"",prefix:typeof data.anchor.prefix==="string"?data.anchor.prefix:context.prefix,suffix:typeof data.anchor.suffix==="string"?data.anchor.suffix:context.suffix};
        const thread=store.createThread(opened.document.id,anchor,data.comment);broadcast("thread",{thread});queueFeedback(thread.messages.at(-1).id);return send(res,201,thread);
      }
      const messageStatus=url.pathname.match(/^\/api\/threads\/([^/]+)\/messages\/([^/]+)\/agent-status$/);
      if(req.method==="POST"&&messageStatus){const data=await body(req);if(!["received","processing","completed","error"].includes(data.status))return send(res,400,{error:"エージェント状態が不正です"});const message=store.setAgentStatus(opened.document.id,messageStatus[1],messageStatus[2],data.status);if(!message)return send(res,404,{error:"人間のメッセージが見つかりません"});broadcast("message",{threadId:message.threadId,message});return send(res,200,message);}
      const message=url.pathname.match(/^\/api\/threads\/([^/]+)\/messages$/);
      if(req.method==="POST"&&message){const data=await body(req);if(!["human","agent","system"].includes(data.author)||!data.content?.trim())return send(res,400,{error:"Valid author and content are required"});if(!store.threadBelongsToDocument(opened.document.id,message[1]))return send(res,404,{error:"Thread not found"});const msg=store.addMessage(message[1],data.author,data.content);broadcast("message",{threadId:message[1],message:msg});if(data.author==="human")queueFeedback(msg.id);return send(res,201,msg);}
      const status=url.pathname.match(/^\/api\/threads\/([^/]+)\/status$/);
      if(req.method==="POST"&&status){const data=await body(req);if(!["open","resolved"].includes(data.status))return send(res,400,{error:"Invalid status"});const thread=store.setThreadStatus(status[1],data.status);broadcast("thread",{thread});return send(res,200,thread);}
      if(req.method==="GET"&&url.pathname==="/api/feedback")return send(res,200,feedback(state()));
      if(req.method==="GET"&&url.pathname==="/api/revisions")return send(res,200,store.revisions(opened.document.id).map(({content,...r})=>r));
      const diff=url.pathname.match(/^\/api\/revisions\/([^/]+)\/diff$/);
      if(req.method==="GET"&&diff){const rev=store.revisionById(diff[1]);if(!rev)return send(res,404,{error:"Revision not found"});const all=store.revisions(opened.document.id),idx=all.findIndex(r=>r.id===rev.id),prev=all[Math.max(0,idx-1)];return send(res,200,{diff:idx===0?"No previous revision":unifiedDiff(prev.content,rev.content,`Revision ${prev.number}`,`Revision ${rev.number}`)});}
      const restore=url.pathname.match(/^\/api\/revisions\/([^/]+)\/restore$/);
      if(req.method==="POST"&&restore){const rev=store.revisionById(restore[1]);if(!rev)return send(res,404,{error:"Revision not found"});writing=true;await writeFile(options.documentPath,rev.content,"utf8");latestContent=rev.content;const created=store.addRevision(opened.document.id,rev.content,`Restored from Revision ${rev.number}`,[]);for(const thread of store.threads(opened.document.id)){const anchor=reanchor(thread.anchor,rev.content);store.updateAnchor(thread.id,anchor??thread.anchor,!anchor);}setTimeout(()=>writing=false,300);broadcast("revision",{revision:created});return send(res,201,created);}
      if(req.method==="POST"&&url.pathname==="/api/finish"){
        const data=await body(req),open=store.threads(opened.document.id).filter(t=>t.status==="open");
        const result=data.result==="abandoned"?"abandoned":open.length?"completed-with-open-threads":"approved";const completedAt=store.finish(opened.session.id,result);const output={...feedback(state()),result,completedAt};send(res,200,output);broadcast("finished",output);notifyAgents(agentClients,"finished",output);setTimeout(()=>complete(output),50);return;
      }
      return send(res,404,{error:"Not found"});
    } catch(error){console.error(error);send(res,500,{error:error.message});}
  });
  try {
    await new Promise((resolve,reject)=>{server.once("error",reject);server.listen(options.port||0,"127.0.0.1",resolve);});
  } catch (error) {
    clearTimeout(debounce); watcher.close(); store.close(); throw error;
  }
  const address=server.address(),url=`http://127.0.0.1:${address.port}`;
  if(options.openBrowser) open(url);
  return {url,completion,close:async()=>{clearTimeout(debounce);watcher.close();for(const c of clients)c.end();for(const c of agentClients)c.end();agentDelivery.clear();await new Promise(r=>server.close(r));store.close();}};

  function queueFeedback(messageId){const event=store.agentEventForMessage(messageId);if(event)for(const client of agentClients)sendAgentEvent(client,event);}
  function sendAgentEvent(client,event){const delivered=agentDelivery.get(client);if(!delivered||delivered.has(event.id))return;delivered.add(event.id);client.write(`event: feedback\ndata: ${JSON.stringify({...feedback(state()),eventId:event.id,threadId:event.threadId,messageId:event.messageId})}\n\n`);}
}

function feedback(s){return {type:"review_feedback",document:s.document.path,revision:s.revision.number,sessionId:s.session.id,threads:s.threads.filter(t=>t.status==="open").map(t=>({id:t.id,quote:t.anchor.selectedText,lineRange:{start:t.anchor.startLine,end:t.anchor.endLine},surroundingContext:{prefix:t.anchor.prefix,suffix:t.anchor.suffix},orphaned:t.orphaned,messages:t.messages}))};}
function notifyAgents(clients,event,payload){const message=`event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`;for(const client of clients)client.write(message);}
function open(url){const [cmd,args]=process.platform==="darwin"?["open",[url]]:process.platform==="win32"?["cmd",["/c","start",url]]:["xdg-open",[url]];execFile(cmd,args,()=>{});}
