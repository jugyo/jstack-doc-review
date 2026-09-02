# jstack-md

`jstack-md` opens AI-authored Markdown in a local browser and provides an interactive workflow for questions, answers, and edits with an agent. It supports comments on selected text, agent replies, document editing, and revision review without Git or project metadata.

## Requirements

- Node.js 22.5 or later (uses the built-in SQLite module)

## Installation

```bash
npx skills add jugyo/jstack-md --skill jstack-md --global --yes
```

This installs the integration for agents supported by the [`skills`](https://skills.sh/) CLI. The skill runs the `jstack-md` CLI through `npx`, so no separate global npm installation is required. Restart the agent if the skill is not recognized immediately.

When developing this repository locally, use `npm link` to use the working copy instead of the published package.

## Open a document

Ask the authoring agent to open a document:

```text
Open README.md with jstack-md.
```

When no path is provided, jstack-md searches the current working directory (or the directory passed with `--cwd`) and selects the most recently created readable and writable Markdown file. The selected path is printed in the startup log. If no Markdown file is available, the skill saves the latest substantial user-facing text to a temporary text file and passes it with `--text-file`. jstack-md preserves that content in a temporary Markdown file before starting the review and prints the saved path in the log.

The automatic target selection order is:

1. An explicitly provided Markdown path
2. The most recently created Markdown file
3. A temporary Markdown file created from the latest substantial user-facing text

If neither source is available, jstack-md does not start and reports that a Markdown path or long text is required.

The skill launches the local browser UI and keeps the current authoring-agent session connected. Each browser comment immediately notifies that agent, which can reply in the inline thread or edit the Markdown without requiring copy and paste.

You can also use the CLI directly.

```bash
jstack-md ./design.md
```

The same automatic selection is used when the CLI is started without a path. If no Markdown file exists and the long text to review has been saved to `context.txt`, start it as follows:

```bash
jstack-md --text-file ./context.txt
```

The CLI binds only to `127.0.0.1`, opens the browser, and waits. On finish it writes the structured review result to stdout and exits. Review data lives in `~/.jstack-md/review.db`, never beside the document.

Use `--no-open` in headless environments and `--json` to suppress the informational URL. Tests can use `--data-dir` to change the storage location.

## Interact with the agent

Start the process from the same agent session and connect to the browser through the displayed local URL.

```text
GET  /api/feedback
GET  /api/agent-events
POST /api/threads/:threadId/messages
GET  /api/state
```

Example reply:

```bash
curl -X POST "$DOCUMENT_URL/api/threads/$THREAD_ID/messages" \
  -H 'content-type: application/json' \
  -d '{"author":"agent","content":"This request must remain non-blocking."}'
```

`/api/agent-events` is an SSE stream that sends a complete `document_feedback` event immediately after a user submits an anchored comment or follow-up. Each event includes `eventId`, `threadId`, and `messageId`. Unfinished events remain in a durable queue and are resent after reconnecting. Agents should keep this stream open instead of relying on periodic polling, and update each human message through the agent-status endpoint to `processing`, `completed`, or `error` while handling it.

When the agent edits Markdown, `jstack-md` detects the change, saves a revision, reanchors comments, and notifies the browser. The finish action does not judge confirmation or approval; it ends the session neutrally. The result is always `finished`.

You can also attach the agent's execution context.

```bash
jstack-md design.md --provider claude-code --session-id "$SESSION_ID" --cwd "$PWD"
```

## API

- `POST /api/threads` — `{ anchor, comment }` (anchored comment)
- `POST /api/threads/:id/messages` — `{ author: "human" | "agent" | "system", content }`
- `POST /api/threads/:threadId/messages/:messageId/agent-status` — `{ status: "received" | "processing" | "completed" | "error" }`
- `POST /api/threads/:id/status` — `{ status: "open" | "resolved" }`
- `GET /api/revisions/:id/diff`
- `POST /api/revisions/:id/restore`
- `POST /api/finish` — Ends the session and returns `result: "finished"`
- `GET /events` — SSE stream
- `GET /api/agent-events` — SSE stream for agent-directed questions and comments

Run the checks:

```bash
npm test
```
