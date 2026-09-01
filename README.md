# jstack-md

`jstack-md` turns an AI-authored Markdown file into a local, browser-first review conversation. Select text, leave inline feedback, let the authoring agent reply or edit the file, inspect revisions, and finish the review without Git or project-local metadata.

## Requirements

- Node.js 22.5 or newer (uses the built-in SQLite module)

## Install

```bash
npx skills add jugyo/jstack-md --skill jstack-md-review --global --yes
```

The [`skills`](https://skills.sh/) CLI installs the integration into supported authoring agents. The skill runs the `jstack-md` CLI through `npx`, so a separate global npm installation is not required. Restart the agent if it does not discover the skill immediately.

When developing this repository locally, `npm link` makes the working copy available instead of the published package.

## Review a document

Ask the agent that authored the document to start the review:

```text
Review README.md with jstack-md.
```

The skill launches the local browser UI and keeps the current authoring-agent session connected. Each browser comment immediately notifies that agent, which can reply in the inline thread or edit the Markdown without requiring copy and paste.

For direct CLI use:

```bash
jstack-md ./design.md
```

The CLI binds only to `127.0.0.1`, opens the browser, and waits. On finish it writes the structured review result to stdout and exits. Review data lives in `~/.jstack-md/review.db`, never beside the document.

Use `--no-open` in headless environments and `--json` to suppress the informational URL. `--data-dir` overrides storage for tests.

## Agent workflow

Start the process from the same authoring-agent session and keep it running. The browser and agent communicate through the printed local URL:

```text
GET  /api/feedback
GET  /api/agent-events
POST /api/threads/:threadId/messages
GET  /api/state
```

Example reply:

```bash
curl -X POST "$REVIEW_URL/api/threads/$THREAD_ID/messages" \
  -H 'content-type: application/json' \
  -d '{"author":"agent","content":"The request path must remain non-blocking."}'
```

`/api/agent-events` is an SSE stream that emits a complete `review_feedback` event immediately when the reviewer creates a thread or sends a follow-up. An authoring agent should keep this stream open instead of periodically polling.

The agent edits Markdown normally. `jstack-md` detects the change, snapshots it, reanchors comments, and refreshes the browser via SSE. The final result is `approved`, `completed-with-open-threads`, or `abandoned`.

Optional authoring-context metadata:

```bash
jstack-md design.md --provider claude-code --session-id "$SESSION_ID" --cwd "$PWD"
```

## API

- `POST /api/threads` — `{ anchor, comment }`
- `POST /api/threads/:id/messages` — `{ author: "human" | "agent" | "system", content }`
- `POST /api/threads/:id/status` — `{ status: "open" | "resolved" }`
- `GET /api/revisions/:id/diff`
- `POST /api/revisions/:id/restore`
- `POST /api/finish` — optionally `{ result: "abandoned" }`
- `GET /events` — SSE stream
- `GET /api/agent-events` — authoring-agent feedback SSE stream

Run checks with `npm test`.
