---
name: jstack-md
description: jstack-md のブラウザ画面でローカルの AI 作成 Markdown を開き、作成エージェントとの質問・回答・編集を進める。ユーザーが Markdown を開く、質問する、コメントする、または対話しながら更新するときに使う。
---

# jstack-md

現在のエージェントセッションを文書の作成エージェントとして使います。質問やコメントを別の LLM セッションへ渡してはいけません。

When a target path is provided, use that Markdown file. When no path is provided, jstack-md searches the current working directory (or the directory passed with `--cwd`) and selects the most recently created readable and writable Markdown file. The selected path is printed to stderr at startup; tell the user which path was selected.

If no Markdown candidate exists and the current context contains reviewable substantial text, such as the latest user-facing explanation, save it unchanged to a temporary text file and start jstack-md with `--text-file <path>`. jstack-md creates a temporary Markdown file and prints its path to stderr. If neither a candidate nor long text is available, do not start jstack-md; return the error asking the user for a Markdown path or long text.

1. Resolve the target using the order above, then start `npx --yes jstack-md [<path>] --provider <agent-name> --cwd <project-cwd>` as a long-running background process. When long text was saved, omit `[<path>]` and add `--text-file <path>`. Capture the selected path, saved path, and local URL printed to stderr, and keep the process handle. A locally linked `jstack-md` package may be used during development.
2. ブラウザ画面の準備ができたことをユーザーへ伝えます。直ちに `GET <url>/api/agent-events` を第二の長時間実行プロセス（例: `curl -N`）として開き、そのプロセスを待ちながらエージェントのターンを維持します。画面を開いただけでターンを終了してはいけません。定期ポーリングを主な通知手段にしないでください。
3. `feedback` SSE イベントは、ユーザーが箇所付きコメントまたはフォローアップを送ったことを示します。イベントの選択テキスト、前後の文脈、文書、既存のスレッドメッセージを使って、返信、Markdown の編集、またはその両方を判断します。ユーザーにコメントのコピーを依頼してはいけません。
4. `feedback` イベントには `eventId`、`threadId`、`messageId` が含まれます。連続して届いた複数のイベントも含め、各人間メッセージ ID を独立して処理してください。先のイベントを処理中だからといって、後続イベントを破棄してはいけません。
5. 人間のメッセージを処理する前に、`POST <url>/api/threads/:threadId/messages/:messageId/agent-status` へ JSON `{ "status": "processing" }` を送り、エージェントが処理を開始したことを表示します。回答は `POST <url>/api/threads/:id/messages` へ JSON `{ "author": "agent", "content": "..." }` を送ります。要求された場合は元の Markdown を直接編集してください。jstack-md が自動的にリビジョンを作成してブラウザへ通知します。回答または編集後は `{ "status": "completed" }` に更新し、処理に失敗した場合は `{ "status": "error" }` に更新します。人間に代わってスレッドを解決してはいけません。
6. 回答または編集のたびに、同じイベントストリームの待機へ戻ってください。各人間メッセージ ID をスレッドごとに記録し、それぞれ一度だけ処理します。ストリームが予期せず切断された場合は再接続してください。未完了イベントは保持されて再送されます。また、再接続中に取りこぼしたイベントを補うため `GET <url>/api/feedback` を一度取得してください。
7. `finished` SSE イベントでループを終了します。その後 jstack-md プロセスの stdout に出力された JSON を読み、最終パスと終了結果を報告してください。ユーザーが明示的に対話を終了した場合も停止します。未処理のフィードバックがあれば明記してください。

このワークフローで起動したプロセスが出力した URL だけに接続してください。jstack-md は `127.0.0.1` で待ち受けます。外部へ公開してはいけません。
