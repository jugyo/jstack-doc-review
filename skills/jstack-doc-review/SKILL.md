---
name: jstack-doc-review
description: Open local documents in the jstack-doc-review browser UI and conduct questions, answers, and edits with the authoring agent. Use when the user wants to open, question, comment on, or update a document interactively.
---

# jstack-doc-review

Use the current agent session as the document's authoring agent. Do not forward questions or comments to another LLM session.

When a target path is provided, use that document. When no path is provided, jstack-doc-review searches the current working directory (or the directory passed with `--cwd`) and selects the most recently created readable and writable Markdown file. The selected path is printed to stderr at startup; tell the user which path was selected.

If no Markdown candidate exists and the current context contains reviewable substantial text, such as the latest user-facing explanation, save it unchanged to a temporary text file and start jstack-doc-review with `--text-file <path>`. jstack-doc-review creates a temporary Markdown file and prints its path to stderr. If neither a candidate nor long text is available, do not start jstack-doc-review; return the error asking the user for a Markdown path or long text.

1. Resolve the directory containing this `SKILL.md`, then resolve the target using the order above. Start `node <skill-directory>/scripts/start.js [<path>] --provider <agent-name> --cwd <project-cwd>` as a long-running background process. When long text was saved, omit `[<path>]` and add `--text-file <path>`. Capture the selected path, saved path, and local URL printed to stderr, and keep the process handle. The runtime is bundled with this skill; do not install or invoke an npm package for it.
2. Tell the user when the browser UI is ready. Immediately open `GET <url>/api/agent-events` as a second long-running process (for example, `curl -N`) and keep the agent turn active while waiting on it. Do not end the turn after only opening the UI. Do not use periodic polling as the primary notification mechanism.
3. A `feedback` SSE event means that the user submitted an anchored comment or follow-up. Use the event's selected text, surrounding context, document, and existing thread messages to decide whether to reply, edit the Markdown, or do both. Do not ask the user to copy the comment.
4. Each `feedback` event includes `eventId`, `threadId`, and `messageId`. Process every human message ID independently, including multiple events that arrive consecutively. Do not discard a later event because an earlier event is still being processed.
5. Before processing a human message, POST JSON `{ "status": "processing" }` to `POST <url>/api/threads/:threadId/messages/:messageId/agent-status` so the agent's work is visible. Send replies to `POST <url>/api/threads/:id/messages` as JSON `{ "author": "agent", "content": "..." }`. Edit the original Markdown directly when requested. jstack-doc-review automatically creates a revision and notifies the browser. After replying or editing, update the status to `{ "status": "completed" }`; if processing fails, update it to `{ "status": "error" }`. Do not resolve threads on the human's behalf.
6. After each reply or edit, return to waiting on the same event stream. Track each human message ID per thread and process each one exactly once. Reconnect if the stream disconnects unexpectedly. Unfinished events are retained and resent. Also fetch `GET <url>/api/feedback` once after reconnecting to cover events missed during reconnection.
7. End the loop on the `finished` SSE event. Then read the JSON printed to stdout by the jstack-doc-review process and report the final path and result. Also stop if the user explicitly ends the conversation. Mention any unprocessed feedback.

Connect only to URLs printed by processes started in this workflow. jstack-doc-review listens on `127.0.0.1`; do not expose it externally.
