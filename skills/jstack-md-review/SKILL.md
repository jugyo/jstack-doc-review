---
name: jstack-md-review
description: Review a local AI-authored Markdown document in the jstack-md browser UI while preserving the current authoring-agent workflow. Use when the user asks to open, review, or iterate on a Markdown file with jstack-md.
---

# jstack-md review

Use the current agent session as the document's authoring agent. Do not hand feedback to a separate LLM session.

1. Ensure the target Markdown exists, then start `npx --yes jstack-md <path> --provider <agent-name> --cwd <project-cwd>` as a long-running background process. Capture the local URL printed on stderr and keep the process handle. A locally linked `jstack-md` package may be used during development.
2. Tell the user that the browser review is ready. Immediately open `GET <url>/api/agent-events` as a second long-running process (for example, `curl -N`) and wait on that process while keeping the agent turn active. Do not end the turn after merely opening the browser and do not use periodic polling as the primary trigger.
3. A `feedback` SSE event means the human just created a thread or sent a follow-up. React as soon as it arrives. Use its selected quote, surrounding context, document, and existing thread messages to decide whether to answer, edit the Markdown, or both. Do not ask the user to copy comments into chat.
4. Add answers with `POST <url>/api/threads/:id/messages` using JSON `{ "author": "agent", "content": "..." }`. Edit the original Markdown file directly when requested; jstack-md creates and broadcasts the revision automatically. Never resolve a thread for the human.
5. After every reply or edit, resume waiting on the same event stream. Track the last handled human message ID per thread so it is handled once. If the stream disconnects unexpectedly, reconnect it and fetch `GET <url>/api/feedback` once to catch events missed during reconnection.
6. A `finished` SSE event ends the loop. Then read the jstack-md process's stdout JSON and report the final path and result. Also stop if the user explicitly ends the workflow. If the result is `completed-with-open-threads`, clearly mention the remaining open feedback.

Bind only to the URL emitted by the process started in this workflow. jstack-md listens on `127.0.0.1`; do not expose it externally.
