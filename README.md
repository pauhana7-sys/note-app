# ナツヤ狙い目サイト（MVP：スクショ→AI要約）

攻略スクショをアップすると、Claude（Anthropic API）が狙い目・数値・示唆の要点を要約するミニアプリです。

## ファイル
- `index.html` … 画面（アップロード＋結果表示）
- `api/summarize.js` … Vercelのサーバー関数（ここでAPIキーを安全に使う）
- `server.js` … ローカル確認用（Vercelでは使いません／無くてもOK）

## デプロイ手順（Vercel）
1. **Anthropic APIキーを作る**：console.anthropic.com → API Keys → Create Key。課金（支払い方法）も設定。作ったキー（`sk-ant-...`）は控えておく。
2. **Vercelアカウントを作る**：vercel.com（GitHubでサインインが楽）。
3. **このフォルダをVercelに載せる**（GitHubリポジトリ経由がおすすめ）。
4. **環境変数を設定**：Vercelのプロジェクト → Settings → Environment Variables で
   - Name: `ANTHROPIC_API_KEY` / Value: 手順1のキー
   - （任意）`ANTHROPIC_MODEL` で使うモデルを変更可（既定: claude-3-5-sonnet-latest）
5. **Deploy** → 発行されたURLを開く。画像をアップして「AIで要約する」。

※ APIキー未設定の状態でも画面は動きます（ダミー要約が出ます）。キーを入れると本物のAI要約に切り替わります。

## ローカルで試す（任意）
```
node server.js   # → http://localhost:3000
```
