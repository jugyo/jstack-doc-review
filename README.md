# jstack-md

`jstack-md` turns an AI-authored Markdown file into a local, browser-first review conversation. Select text or comment on the whole document, let the authoring agent reply or edit the file, inspect revisions, and finish the review without Git or project-local metadata.

## Requirements

- Node.js 22.5 or newer (uses the built-in SQLite module)

## Install

```bash
npx skills add jugyo/jstack-md --skill jstack-md --global --yes
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

`/api/agent-events` は、レビュアーがスレッドを作成またはフォローアップを送信した直後に、完全な `review_feedback` イベントを送る SSE ストリームです。各イベントには `eventId`、`threadId`、`messageId` が含まれます。未完了イベントは永続キューに保持され、再接続後に再送されます。著者エージェントは定期的なポーリングではなくこのストリームを開いたままにし、処理中の各人間メッセージを agent-status エンドポイントで `processing`、`completed`、または `error` に更新してください。

The agent edits Markdown normally. `jstack-md` detects the change, snapshots it, reanchors comments, and refreshes the browser via SSE. The final result is `approved`, `completed-with-open-threads`, or `abandoned`.

Optional authoring-context metadata:

```bash
jstack-md design.md --provider claude-code --session-id "$SESSION_ID" --cwd "$PWD"
```

## API

- `POST /api/threads` — `{ anchor, comment }`; inline anchors use line fields, while a document-wide comment uses `{ anchor: { type: "document" }, comment }`
- `POST /api/threads/:id/messages` — `{ author: "human" | "agent" | "system", content }`
- `POST /api/threads/:threadId/messages/:messageId/agent-status` — `{ status: "received" | "processing" | "completed" | "error" }`
- `POST /api/threads/:id/status` — `{ status: "open" | "resolved" }`
- `GET /api/revisions/:id/diff`
- `POST /api/revisions/:id/restore`
- `POST /api/finish` — optionally `{ result: "abandoned" }`
- `GET /events` — SSE stream
- `GET /api/agent-events` — authoring-agent feedback SSE stream

Document-wide feedback is returned with `scope: "document"`, `lineRange: null`, and `surroundingContext: null`. It is kept in the same thread collection as inline feedback, can receive replies, and is included in agent notifications without being re-anchored to a line.

Run checks with `npm test`.
