import { sourceOffsetForMappedText, sourceTextForRange } from "./selection.js";
import { escapeHtml as esc, renderMarkdown } from "./markdown.js";

let state, selection, historyRevisionId, composerSubmitting = false;
const VISIBLE_MESSAGE_COUNT = 3;
const expandedThreads = new Set();
const $ = selector => document.querySelector(selector);
const isSubmitShortcut = event => (event.metaKey || event.ctrlKey) && event.key === "Enter";

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

function sourceSpan(visible, start, end, textStart = start, textEnd = end) {
  return `<span data-source-start="${start}" data-source-end="${end}" data-source-text-start="${textStart}" data-source-text-end="${textEnd}">${esc(visible)}</span>`;
}

function inline(value, sourceOffset = 0) {
  const pattern = /`([^`]+)`|\*\*([^*]+)\*\*|\*([^*]+)\*|\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g;
  let html = "", cursor = 0, match;
  while ((match = pattern.exec(value))) {
    if (match.index > cursor) html += sourceSpan(value.slice(cursor, match.index), sourceOffset + cursor, sourceOffset + match.index);
    const start = sourceOffset + match.index, end = sourceOffset + pattern.lastIndex;
    if (match[1]) html += `<code>${sourceSpan(match[1], start, end, start + 1, end - 1)}</code>`;
    else if (match[2]) html += `<strong>${sourceSpan(match[2], start, end, start + 2, end - 2)}</strong>`;
    else if (match[3]) html += `<em>${sourceSpan(match[3], start, end, start + 1, end - 1)}</em>`;
    else html += `<a href="${esc(match[5])}" target="_blank" rel="noreferrer">${inline(match[4], start + 1)}</a>`;
    cursor = pattern.lastIndex;
  }
  return html + (cursor < value.length ? sourceSpan(value.slice(cursor), sourceOffset + cursor, sourceOffset + value.length) : "");
}

function markdownLine(line, inCode) {
  if (/^```/.test(line)) return { html: "", code: !inCode };
  if (inCode) return { html: sourceSpan(line, 0, line.length), cls: "block-code", code: inCode };
  let match;
  if (match = line.match(/^(#{1,3})(\s+)(.*)$/)) {
    const prefix = match[1].length + match[2].length;
    return { html: `<h${match[1].length}>${sourceSpan(match[3], 0, line.length, prefix, line.length)}</h${match[1].length}>`, code: inCode };
  }
  if (match = line.match(/^(>\s?)(.*)$/)) return { html: sourceSpan(match[2], 0, line.length, match[1].length, line.length), cls: "quote", code: inCode };
  if (match = line.match(/^([-*+])(\s+)(.*)$/)) {
    const prefix = match[1].length + match[2].length;
    return { html: sourceSpan("• ", 0, prefix, 0, prefix) + inline(match[3], prefix), cls: "list", code: inCode };
  }
  if (match = line.match(/^\d+\.\s+(.*)$/)) return { html: inline(line), cls: "list", code: inCode };
  return { html: inline(line), code: inCode };
}

function render() {
  document.title = `${state.document.name} — jstack-doc-review`;
  $("#filename").textContent = state.document.name;
  let code = false;
  let documentHtml = "";
  const comments = [...state.threads].sort((a, b) => {
    if (a.orphaned !== b.orphaned) return a.orphaned ? 1 : -1;
    const aLine = a.anchor.type === "document" ? 0 : a.anchor.startLine;
    const bLine = b.anchor.type === "document" ? 0 : b.anchor.startLine;
    return (aLine - bLine) || a.createdAt.localeCompare(b.createdAt);
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
  const documentComments = comments.filter(thread => thread.anchor.type === "document");
  const attached = comments.filter(thread => !thread.orphaned && thread.anchor.type !== "document");
  const commentHtml = (documentComments.length ? `<div class="document-threads">${documentComments.map(threadHtml).join("")}</div>` : "") + attached.map(threadHtml).join("") + (detached.length ? `<div class="detached-threads"><div class="detached-label">Detached comments</div>${detached.map(threadHtml).join("")}</div>` : "");
  const globalComposer = `<form class="global-composer" id="globalComposer"><textarea aria-label="Comment" placeholder="Write a comment…" rows="3"></textarea><div class="global-composer-actions"><button type="submit" class="primary">Send</button></div></form>`;
  const railHeader = `<div class="rail-heading"><div><span class="rail-kicker">CONVERSATION</span><strong>Comments</strong></div><span class="thread-count">${comments.length} comment${comments.length === 1 ? "" : "s"}</span></div>`;
  const emptyRail = commentHtml ? "" : '<div class="empty-rail">No comments yet</div>';
  $("#document").innerHTML = `<div class="document-layout"><div class="document-content">${documentHtml}</div><div class="comment-rail">${globalComposer}${railHeader}${commentHtml}${emptyRail}</div></div>`;
  renderHistory();
  $("#binding").textContent = state.agentBinding
    ? `Bound to ${state.agentBinding.provider}${state.agentBinding.sessionId ? ` · ${state.agentBinding.sessionId}` : ""}`
    : "No authoring agent is bound.";
}

function threadHtml(thread) {
  const documentWide = thread.anchor.type === "document";
  const range = documentWide ? "Document" : thread.anchor.startLine === thread.anchor.endLine
    ? `line ${thread.anchor.startLine}`
    : `lines ${thread.anchor.startLine}–${thread.anchor.endLine}`;
  const detached = thread.orphaned ? "Detached · " : "";
  if (thread.status === "resolved") {
    return `<article class="thread resolved collapsed ${thread.orphaned ? "orphaned" : ""}" data-thread="${thread.id}" data-start-line="${thread.anchor.startLine}" data-end-line="${thread.anchor.endLine}">
      <div class="thread-head"><span>${detached}Resolved · ${range}</span><button type="button" data-status="open">Reopen</button></div>
    </article>`;
  }
  const olderCount = Math.max(0, thread.messages.length - VISIBLE_MESSAGE_COUNT);
  const expanded = expandedThreads.has(thread.id);
  return `<article class="thread open ${expanded ? "messages-expanded" : ""} ${thread.orphaned ? "orphaned" : ""}" data-thread="${thread.id}" data-start-line="${thread.anchor.startLine}" data-end-line="${thread.anchor.endLine}">
    <div class="thread-head"><span>${detached}Conversation · ${range}</span><button type="button" data-status="resolved">Resolve</button></div>
    ${olderCount ? `<button type="button" class="thread-toggle" data-toggle-messages data-older-count="${olderCount}" aria-expanded="${expanded}">${toggleLabel(olderCount, expanded)}</button>` : ""}
    ${thread.messages.map((message, index) => `<div class="message ${message.author} ${index < olderCount ? "older" : ""}"><div class="message-meta"><span class="author">${esc(message.author)}</span>${message.author === "human" && message.agentStatus ? `<span class="message-status ${message.agentStatus}">${statusLabel(message.agentStatus)}</span>` : ""}</div><div class="message-body">${renderMarkdown(message.content)}</div></div>`).join("")}
    <form class="reply"><textarea placeholder="Continue this conversation…" aria-label="Reply" rows="2"></textarea><button type="submit">Reply</button></form>
  </article>`;
}

function toggleLabel(olderCount, expanded) {
  return expanded ? "Hide older messages" : `Show ${olderCount} older message${olderCount === 1 ? "" : "s"}`;
}

function toggleThreadMessages(thread) {
  const expanded = !expandedThreads.has(thread.dataset.thread);
  if (expanded) expandedThreads.add(thread.dataset.thread);
  else expandedThreads.delete(thread.dataset.thread);
  thread.classList.toggle("messages-expanded", expanded);
  const toggle = thread.querySelector(".thread-toggle");
  toggle.textContent = toggleLabel(Number(toggle.dataset.olderCount), expanded);
  toggle.setAttribute("aria-expanded", String(expanded));
}

function statusLabel(status) {
  return ({ received: "Received", processing: "Processing", completed: "Completed", error: "Error" })[status] || status;
}

function toggleThreadHighlight(thread, highlighted) {
  if (thread.classList.contains("orphaned")) return;
  const startLine = Number(thread.dataset.startLine), endLine = Number(thread.dataset.endLine);
  if (!Number.isInteger(startLine) || !Number.isInteger(endLine)) return;
  document.querySelectorAll(".doc-line").forEach(line => {
    const lineNumber = Number(line.dataset.line);
    if (lineNumber >= startLine && lineNumber <= endLine) line.classList.toggle("thread-hover", highlighted);
  });
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
  openComposer(source.getBoundingClientRect());
  showSelection($("#composer"), text, line, line);
}

function openComposer(box) {
  const composer = $("#composer");
  $("#selection-trigger").hidden = true;
  composer.hidden = false;
  composer.style.left = `${Math.min(innerWidth - 390, Math.max(10, box.right + 8))}px`;
  composer.style.top = `${Math.min(innerHeight - 190, Math.max(10, box.top))}px`;
  composer.querySelector("textarea").focus();
}

document.addEventListener("mouseup", event => {
  if (event.target.closest("#composer,#selection-trigger")) return;
  if (!event.target.closest(".document-content")) return hideSelectionTrigger();
  const selected = getSelection();
  if (!selected || selected.isCollapsed) return hideSelectionTrigger();
  const range = selected.getRangeAt(0);
  const start = elLine(range.startContainer);
  const end = elLine(range.endContainer);
  if (!selected.toString().trim() || !start || !end) return hideSelectionTrigger();
  const a = Math.min(start, end), b = Math.max(start, end), lines = state.document.content.split("\n");
  const startBody = document.querySelector(`[data-line="${a}"] .line-body`);
  const endBody = document.querySelector(`[data-line="${b}"] .line-body`);
  const startOffset = sourceOffsetAt(range.startContainer, range.startOffset, startBody, lines[a - 1]);
  const endOffset = sourceOffsetAt(range.endContainer, range.endOffset, endBody, lines[b - 1]);
  const text = sourceTextForRange(lines, a, startOffset, b, endOffset);
  selection = { startLine: a, endLine: b, selectedText: text, prefix: lines.slice(Math.max(0, a - 3), a - 1).join("\n"), suffix: lines.slice(b, b + 2).join("\n") };
  const box = range.getBoundingClientRect(), trigger = $("#selection-trigger");
  $("#composer").hidden = true;
  trigger.style.left = `${Math.min(innerWidth - 38, Math.max(10, box.right + 6))}px`;
  trigger.style.top = `${Math.min(innerHeight - 38, Math.max(10, box.top - 30))}px`;
  trigger.hidden = false;
});

function hideSelectionTrigger() {
  $("#selection-trigger").hidden = true;
}

function showSelection(composer, text, startLine, endLine) {
  const label = startLine == null ? "Document" : startLine === endLine ? `line ${startLine}` : `lines ${startLine}–${endLine}`;
  const preview = composer.querySelector(".selection");
  preview.textContent = text.trim() ? text : "No text selected";
  preview.dataset.range = label;
  preview.setAttribute("aria-label", `${label}: ${text}`);
}

function elLine(node) {
  return node?.nodeType === 3 ? node.parentElement?.closest(".doc-line")?.dataset.line : node?.closest?.(".doc-line")?.dataset.line;
}

function sourceOffsetAt(node, offset, body, sourceLine = "") {
  if (!body || sourceLine === "" || sourceLine === "\r") return 0;
  if (node?.nodeType === 3) {
    const mapped = node.parentElement?.closest("[data-source-start]");
    if (mapped) return mappedOffset(mapped, offset);
  }
  if (node?.nodeType === 1 && node.matches("[data-source-start]")) {
    return offset === 0 ? Number(node.dataset.sourceStart) : Number(node.dataset.sourceEnd);
  }
  if (node?.childNodes?.length) {
    const child = node.childNodes[offset] || node.lastChild;
    if (child) return sourceOffsetAt(child, offset === node.childNodes.length ? child.childNodes?.length || child.textContent.length : 0, body, sourceLine);
  }
  return offset ? sourceLine.length : 0;
}

function mappedOffset(mapped, offset) {
  return sourceOffsetForMappedText({
    sourceStart: Number(mapped.dataset.sourceStart),
    sourceEnd: Number(mapped.dataset.sourceEnd),
    sourceTextStart: Number(mapped.dataset.sourceTextStart),
    sourceTextEnd: Number(mapped.dataset.sourceTextEnd),
    visibleLength: mapped.textContent.length
  }, offset);
}

$("#selection-trigger").onclick = () => {
  if (!selection) return;
  openComposer($("#selection-trigger").getBoundingClientRect());
  showSelection($("#composer"), selection.selectedText, selection.startLine, selection.endLine);
};
$("#composer [data-cancel]").onclick = () => {
  $("#composer").hidden = true;
  hideSelectionTrigger();
};
async function submitComposer() {
  if (composerSubmitting) return;
  const textarea = $("#composer textarea"), comment = textarea.value.trim();
  if (!comment) return;
  composerSubmitting = true;
  try {
    await api("/api/threads", { method: "POST", body: JSON.stringify({ anchor: selection, comment }) });
    textarea.value = "";
    $("#composer").hidden = true;
    hideSelectionTrigger();
    getSelection().removeAllRanges();
    await load("Comment sent to the authoring agent.");
  } finally {
    composerSubmitting = false;
  }
}
$("#composer [data-submit]").onclick = submitComposer;
$("#composer textarea").addEventListener("keydown", event => {
  if (!isSubmitShortcut(event)) return;
  event.preventDefault();
  submitComposer();
});

document.addEventListener("click", event => {
  if ($("#composer").hidden || event.target.closest("#composer,#selection-trigger,[data-comment-line]")) return;
  $("#composer").hidden = true;
  hideSelectionTrigger();
});

$("#document").addEventListener("click", async event => {
  const trigger = event.target.closest("[data-comment-line]");
  if (trigger) return openLineComposer(Number(trigger.dataset.commentLine), trigger);
  const toggle = event.target.closest("[data-toggle-messages]");
  if (toggle) return toggleThreadMessages(toggle.closest(".thread"));
  const status = event.target.dataset.status;
  if (status) {
    await api(`/api/threads/${event.target.closest(".thread").dataset.thread}/status`, { method: "POST", body: JSON.stringify({ status }) });
    await load();
  }
});

$("#document").addEventListener("mouseover", event => {
  const thread = event.target.closest?.(".thread");
  if (!thread || (event.relatedTarget instanceof Node && thread.contains(event.relatedTarget))) return;
  toggleThreadHighlight(thread, true);
});

$("#document").addEventListener("mouseout", event => {
  const thread = event.target.closest?.(".thread");
  if (!thread || (event.relatedTarget instanceof Node && thread.contains(event.relatedTarget))) return;
  toggleThreadHighlight(thread, false);
});

$("#document").addEventListener("submit", async event => {
  if (event.target.matches(".global-composer")) {
    event.preventDefault();
    const textarea = event.target.querySelector("textarea"), comment = textarea.value.trim();
    if (!comment) return;
    await api("/api/threads", { method: "POST", body: JSON.stringify({ anchor: { type: "document" }, comment }) });
    textarea.value = "";
    await load("Sent.");
    return;
  }
  if (!event.target.matches(".reply")) return;
  event.preventDefault();
  const textarea = event.target.querySelector("textarea"), content = textarea.value.trim();
  if (!content) return;
  await api(`/api/threads/${event.target.closest(".thread").dataset.thread}/messages`, { method: "POST", body: JSON.stringify({ author: "human", content }) });
  textarea.value = "";
  await load();
});

$("#document").addEventListener("keydown", event => {
  if (!isSubmitShortcut(event) || !event.target.matches?.("textarea")) return;
  const form = event.target.closest(".reply, .global-composer");
  if (!form) return;
  event.preventDefault();
  form.requestSubmit();
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
$("#finish").onclick = () => finish();
async function finish() {
  const output = await api("/api/finish", { method: "POST", body: "{}" });
  document.body.innerHTML = `<div class="done"><h1>Conversation finished</h1><p>You can close this window and return to the authoring agent.</p></div>`;
  window.close();
}
function notice(message) { $("#notice").textContent = message; setTimeout(() => $("#notice").textContent = "", 3500); }

const events = new EventSource("/events");
events.addEventListener("revision", () => load("The document changed. A new revision was created."));
events.addEventListener("message", () => load());
events.addEventListener("thread", () => load());
await load();
