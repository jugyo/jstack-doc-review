let state, selection, historyRevisionId;
const $ = selector => document.querySelector(selector);
const esc = value => String(value).replace(/[&<>"']/g, character => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[character]));

async function api(path, options = {}) {
  const response = await fetch(path, { headers: { "content-type": "application/json" }, ...options });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "Request failed");
  return data;
}

async function load(message) {
  state = await api("/api/state");
  render();
  if (message) notice(message);
}

function inline(value) {
  return esc(value)
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/\*([^*]+)\*/g, "<em>$1</em>")
    .replace(/\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g, '<a href="$2" target="_blank" rel="noreferrer">$1</a>');
}

function markdownLine(line, inCode) {
  if (/^```/.test(line)) return { html: "", code: !inCode };
  if (inCode) return { html: esc(line), cls: "block-code", code: inCode };
  let match;
  if (match = line.match(/^(#{1,3})\s+(.*)$/)) return { html: `<h${match[1].length}>${inline(match[2])}</h${match[1].length}>`, code: inCode };
  if (match = line.match(/^>\s?(.*)$/)) return { html: inline(match[1]), cls: "quote", code: inCode };
  if (match = line.match(/^[-*+]\s+(.*)$/)) return { html: "• " + inline(match[1]), cls: "list", code: inCode };
  if (match = line.match(/^\d+\.\s+(.*)$/)) return { html: inline(line), cls: "list", code: inCode };
  return { html: inline(line), code: inCode };
}

function render() {
  document.title = `${state.document.name} — jstack-md`;
  $("#filename").textContent = state.document.name;
  let code = false;
  let documentHtml = "";
  const comments = [...state.threads].sort((a, b) => {
    if (a.orphaned !== b.orphaned) return a.orphaned ? 1 : -1;
    return (a.anchor.startLine - b.anchor.startLine) || a.createdAt.localeCompare(b.createdAt);
  });

  state.document.content.split("\n").forEach((line, index) => {
    const lineNumber = index + 1;
    const output = markdownLine(line, code);
    code = output.code;
    documentHtml += `<div class="doc-line" data-line="${lineNumber}">
      <div class="line-body ${output.cls || ""}">${output.html || "&nbsp;"}</div>
      <div class="comment-gutter"><button type="button" class="comment-trigger" data-comment-line="${lineNumber}" aria-label="Add comment to line ${lineNumber}" title="Add comment">＋</button></div>
    </div>`;
  });

  const detached = comments.filter(thread => thread.orphaned);
  const attached = comments.filter(thread => !thread.orphaned);
  const commentHtml = attached.map(threadHtml).join("") + (detached.length ? `<div class="detached-threads"><div class="detached-label">Detached comments</div>${detached.map(threadHtml).join("")}</div>` : "");
  $("#document").innerHTML = `<div class="document-layout"><div class="document-content">${documentHtml}</div><div class="comment-rail">${commentHtml}</div></div>`;
  renderHistory();
  $("#binding").textContent = state.agentBinding
    ? `Bound to ${state.agentBinding.provider}${state.agentBinding.sessionId ? ` · ${state.agentBinding.sessionId}` : ""}`
    : "No authoring agent is bound.";
}

function threadHtml(thread) {
  const range = thread.anchor.startLine === thread.anchor.endLine
    ? `line ${thread.anchor.startLine}`
    : `lines ${thread.anchor.startLine}–${thread.anchor.endLine}`;
  const detached = thread.orphaned ? "Detached · " : "";
  if (thread.status === "resolved") {
    return `<article class="thread resolved collapsed ${thread.orphaned ? "orphaned" : ""}" data-thread="${thread.id}">
      <div class="thread-head"><span>${detached}Resolved · ${range}</span><button type="button" data-status="open">Reopen</button></div>
    </article>`;
  }
  const waiting = thread.messages.at(-1)?.author === "human";
  return `<article class="thread open ${thread.orphaned ? "orphaned" : ""}" data-thread="${thread.id}">
    <div class="thread-head"><span>${detached}Open thread · ${range}</span><button type="button" data-status="resolved">Resolve</button></div>
    ${thread.messages.map(message => `<div class="message ${message.author}"><span class="author">${esc(message.author)}</span><p>${esc(message.content)}</p></div>`).join("")}
    ${waiting ? '<div class="agent-waiting">••• Agent notified</div>' : ""}
    <form class="reply"><input placeholder="Continue this conversation…" aria-label="Reply"><button type="submit">Reply</button></form>
  </article>`;
}

function renderHistory() {
  const selected = historyRevisionId || state.revision.id;
  $("#revisionList").innerHTML = [...state.revisions].reverse().map(revision => `<button class="revision-choice ${revision.id === selected ? "selected" : ""}" data-revision="${revision.id}"><strong>Revision ${revision.number}</strong><span>${esc(revision.reason || "Document changed")}</span><span>${new Date(revision.createdAt).toLocaleString()}</span></button>`).join("");
}

async function selectHistoryRevision(id) {
  historyRevisionId = id;
  renderHistory();
  const revision = state.revisions.find(item => item.id === id);
  const data = await api(`/api/revisions/${id}/diff`);
  $("#historyRevision").textContent = `Revision ${revision.number}`;
  $("#historyMeta").textContent = `${revision.reason || "Document changed"} · ${new Date(revision.createdAt).toLocaleString()}`;
  $("#restoreRevision").dataset.restore = id;
  $("#restoreRevision").disabled = id === state.revision.id;
  $("#historyDiff").innerHTML = data.diff.split("\n").map(line => `<span class="${line.startsWith("+") ? "add" : line.startsWith("-") ? "del" : ""}">${esc(line)}</span>`).join("\n");
}

function openLineComposer(line, source) {
  const lines = state.document.content.split("\n");
  const text = lines[line - 1] || "";
  selection = {
    startLine: line,
    endLine: line,
    selectedText: text,
    prefix: lines.slice(Math.max(0, line - 3), line - 1).join("\n"),
    suffix: lines.slice(line, line + 2).join("\n")
  };
  const box = source.getBoundingClientRect();
  const composer = $("#composer");
  composer.hidden = false;
  composer.style.left = `${Math.min(innerWidth - 390, Math.max(10, box.right + 8))}px`;
  composer.style.top = `${Math.min(innerHeight - 190, Math.max(10, box.top))}px`;
  composer.querySelector(".selection").textContent = text.trim() ? `“${text}” · line ${line}` : `Line ${line}`;
  composer.querySelector("textarea").focus();
}

document.addEventListener("mouseup", event => {
  if (event.target.closest(".thread,#composer,header,dialog")) return;
  const selected = getSelection();
  if (!selected || selected.isCollapsed) return;
  const text = selected.toString().trim();
  const start = elLine(selected.anchorNode);
  const end = elLine(selected.focusNode);
  if (!text || !start || !end) return;
  const a = Math.min(start, end), b = Math.max(start, end), lines = state.document.content.split("\n");
  selection = { startLine: a, endLine: b, selectedText: text, prefix: lines.slice(Math.max(0, a - 3), a - 1).join("\n"), suffix: lines.slice(b, b + 2).join("\n") };
  const box = selected.getRangeAt(0).getBoundingClientRect(), composer = $("#composer");
  composer.hidden = false;
  composer.style.left = `${Math.min(innerWidth - 390, Math.max(10, box.left))}px`;
  composer.style.top = `${Math.min(innerHeight - 190, box.bottom + 10)}px`;
  composer.querySelector(".selection").textContent = `“${text}” · lines ${a}–${b}`;
  composer.querySelector("textarea").focus();
});

function elLine(node) {
  return node?.nodeType === 3 ? node.parentElement?.closest(".doc-line")?.dataset.line : node?.closest?.(".doc-line")?.dataset.line;
}

$("#composer [data-cancel]").onclick = () => $("#composer").hidden = true;
$("#composer [data-submit]").onclick = async () => {
  const textarea = $("#composer textarea"), comment = textarea.value.trim();
  if (!comment) return;
  await api("/api/threads", { method: "POST", body: JSON.stringify({ anchor: selection, comment }) });
  textarea.value = "";
  $("#composer").hidden = true;
  getSelection().removeAllRanges();
  await load("Comment sent to the authoring agent.");
};

$("#document").addEventListener("click", async event => {
  const trigger = event.target.closest("[data-comment-line]");
  if (trigger) return openLineComposer(Number(trigger.dataset.commentLine), trigger);
  const status = event.target.dataset.status;
  if (status) {
    await api(`/api/threads/${event.target.closest(".thread").dataset.thread}/status`, { method: "POST", body: JSON.stringify({ status }) });
    await load();
  }
});

$("#document").addEventListener("submit", async event => {
  if (!event.target.matches(".reply")) return;
  event.preventDefault();
  const input = event.target.querySelector("input"), content = input.value.trim();
  if (!content) return;
  await api(`/api/threads/${event.target.closest(".thread").dataset.thread}/messages`, { method: "POST", body: JSON.stringify({ author: "human", content }) });
  input.value = "";
  await load();
});

$("#history").onclick = async () => {
  historyRevisionId = state.revision.id;
  $("#historyDialog").showModal();
  await selectHistoryRevision(historyRevisionId);
};
$("[data-history-close]").onclick = () => $("#historyDialog").close();
$("#revisionList").onclick = event => {
  const button = event.target.closest("[data-revision]");
  if (button) selectHistoryRevision(button.dataset.revision);
};
$("#restoreRevision").onclick = async event => {
  const id = event.currentTarget.dataset.restore;
  if (!id || !confirm("Restore this revision as a new revision?")) return;
  await api(`/api/revisions/${id}/restore`, { method: "POST", body: "{}" });
  $("#historyDialog").close();
  historyRevisionId = null;
  await load("Revision restored and saved as a new revision.");
};
$("#finish").onclick = () => {
  const count = state.threads.filter(thread => thread.status === "open").length;
  $("#finishText").textContent = count ? `${count} open thread${count === 1 ? "" : "s"} remain. The result will be completed-with-open-threads.` : "All threads are resolved. The result will be approved.";
  $("#finishDialog").showModal();
};
$("#finishDialog [data-cancel]").onclick = () => $("#finishDialog").close();
$("#finishDialog [data-finish]").onclick = () => finish("finish");
$("#finishDialog [data-abandon]").onclick = () => finish("abandoned");
async function finish(result) {
  const output = await api("/api/finish", { method: "POST", body: JSON.stringify({ result }) });
  $("#finishDialog").close();
  document.body.innerHTML = `<div class="done"><h1>Review ${esc(output.result)}</h1><p>You can close this window and return to the authoring agent.</p></div>`;
}
function notice(message) { $("#notice").textContent = message; setTimeout(() => $("#notice").textContent = "", 3500); }

const events = new EventSource("/events");
events.addEventListener("revision", () => load("The document changed. A new revision was created."));
events.addEventListener("message", () => load());
events.addEventListener("thread", () => load());
await load();
