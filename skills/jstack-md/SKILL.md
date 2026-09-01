---
name: jstack-md
description: Review a local AI-authored Markdown document in the jstack-md browser UI while preserving the current authoring-agent workflow. Use when the user asks to open, review, or iterate on a Markdown file with jstack-md.
---

# jstack-md

Use the current agent session as the document's authoring agent. Do not hand feedback to a separate LLM session.

1. Ensure the target Markdown exists, then start `npx --yes jstack-md <path> --provider <agent-name> --cwd <project-cwd>` as a long-running background process. Capture the local URL printed on stderr and keep the process handle. A locally linked `jstack-md` package may be used during development.
2. Tell the user that the browser review is ready. Immediately open `GET <url>/api/agent-events` as a second long-running process (for example, `curl -N`) and wait on that process while keeping the agent turn active. Do not end the turn after merely opening the browser and do not use periodic polling as the primary trigger.
3. A `feedback` SSE event means the human just created a thread or sent a follow-up. React as soon as it arrives. Use its selected quote, surrounding context, document, and existing thread messages to decide whether to answer, edit the Markdown, or both. Do not ask the user to copy comments into chat.
4. `feedback` イベントには `eventId`、`threadId`、`messageId` が含まれます。連続して届いた複数のイベントも含め、各人間メッセージ ID を独立して処理してください。先のイベントを処理中だからといって、後続イベントを破棄してはいけません。
5. 人間のメッセージを処理する前に、`POST <url>/api/threads/:threadId/messages/:messageId/agent-status` へ JSON `{ "status": "processing" }` を送り、エージェントが処理を開始したことを表示します。回答は `POST <url>/api/threads/:id/messages` へ JSON `{ "author": "agent", "content": "..." }` を送ります。要求された場合は元の Markdown を直接編集してください。jstack-md が自動的にリビジョンを作成してブラウザへ通知します。回答または編集後は `{ "status": "completed" }` に更新し、処理に失敗した場合は `{ "status": "error" }` に更新します。人間に代わってスレッドを解決してはいけません。
6. 回答または編集のたびに、同じイベントストリームの待機へ戻ってください。各人間メッセージ ID をスレッドごとに記録し、それぞれ一度だけ処理します。ストリームが予期せず切断された場合は再接続してください。未完了イベントは保持されて再送されます。また、再接続中に取りこぼしたイベントを補うため `GET <url>/api/feedback` を一度取得してください。
7. `finished` SSE イベントでループを終了します。その後 jstack-md プロセスの stdout に出力された JSON を読み、最終パスと結果を報告してください。ユーザーが明示的にワークフローを終了した場合も停止します。結果が `completed-with-open-threads` の場合は、残っている未解決のフィードバックを明記してください。

Bind only to the URL emitted by the process started in this workflow. jstack-md listens on `127.0.0.1`; do not expose it externally.
