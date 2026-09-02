# jstack-md

`jstack-md` は、AI が作成した Markdown をローカルのブラウザで開き、エージェントとの質問・回答・編集の対話を行うツールです。文章の一部へのコメント、エージェントの返信、文書の編集、リビジョン確認を、Git やプロジェクト内のメタデータなしで扱えます。

## 要件

- Node.js 22.5 以降（組み込み SQLite を使用）

## インストール

```bash
npx skills add jugyo/jstack-md --skill jstack-md --global --yes
```

[`skills`](https://skills.sh/) CLI が対応するエージェントへ連携をインストールします。skill は `npx` 経由で `jstack-md` CLI を実行するため、npm パッケージを別途グローバルインストールする必要はありません。skill がすぐに認識されない場合はエージェントを再起動してください。

このリポジトリをローカルで開発するときは、`npm link` で公開パッケージの代わりに作業コピーを使えます。

## 文書を開く

文書を作成したエージェントに、次のように依頼します。

```text
README.md を jstack-md で開いてください。
```

skill はローカルのブラウザ画面を起動し、現在のエージェントセッションとの接続を保ちます。選択範囲へのコメントを送ると、エージェントへ即座に通知されます。エージェントは会話へ返信したり、Markdown を編集したりできます。

CLI を直接使うこともできます。

```bash
jstack-md ./design.md
```

CLI は `127.0.0.1` のみにバインドしてブラウザを開き、終了操作まで待機します。終了時には構造化された対話結果を標準出力へ書き込みます。対話データは `~/.jstack-md/review.db` に保存され、文書の隣には作成されません。

ヘッドレス環境では `--no-open` を使い、情報 URL を非表示にする場合は `--json` を使います。テストでは `--data-dir` で保存先を変更できます。

## エージェントとの対話

同じエージェントセッションからプロセスを起動し、表示されたローカル URL を通じてブラウザと接続します。

```text
GET  /api/feedback
GET  /api/agent-events
POST /api/threads/:threadId/messages
GET  /api/state
```

返信の例:

```bash
curl -X POST "$DOCUMENT_URL/api/threads/$THREAD_ID/messages" \
  -H 'content-type: application/json' \
  -d '{"author":"agent","content":"この要求はノンブロッキングのままにする必要があります。"}'
```

`/api/agent-events` は、ユーザーが箇所付きコメントまたはフォローアップを送った直後に、完全な `document_feedback` イベントを送る SSE ストリームです。各イベントには `eventId`、`threadId`、`messageId` が含まれます。未完了イベントは永続キューに保持され、再接続後に再送されます。エージェントは定期的なポーリングではなくこのストリームを開いたままにし、処理中の各人間メッセージを agent-status エンドポイントで `processing`、`completed`、または `error` に更新してください。

エージェントが Markdown を編集すると、`jstack-md` が変更を検知してリビジョンを保存し、コメントの位置を再配置してブラウザへ通知します。終了操作は確認や承認を判定せず、セッションを中立的に終了します。終了結果は常に `finished` です。

エージェントの実行コンテキストを付加することもできます。

```bash
jstack-md design.md --provider claude-code --session-id "$SESSION_ID" --cwd "$PWD"
```

## API

- `POST /api/threads` — `{ anchor, comment }`（箇所付きコメント）
- `POST /api/threads/:id/messages` — `{ author: "human" | "agent" | "system", content }`
- `POST /api/threads/:threadId/messages/:messageId/agent-status` — `{ status: "received" | "processing" | "completed" | "error" }`
- `POST /api/threads/:id/status` — `{ status: "open" | "resolved" }`
- `GET /api/revisions/:id/diff`
- `POST /api/revisions/:id/restore`
- `POST /api/finish` — セッションを終了し、`result: "finished"` を返す
- `GET /events` — SSE ストリーム
- `GET /api/agent-events` — エージェント向け質問・コメント SSE ストリーム

チェックの実行:

```bash
npm test
```
