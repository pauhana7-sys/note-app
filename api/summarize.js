// Vercel Serverless Function:  POST /api/summarize
// 入力: { media_type, image(base64), kind }  → 出力: { summary }
// APIキーは環境変数 ANTHROPIC_API_KEY から読む（ブラウザには出さない）

const MODEL = process.env.ANTHROPIC_MODEL || "claude-3-5-sonnet-latest";

const PROMPT = (kind) => `あなたはパチスロ攻略記事の編集アシスタントです。
これは「${kind}」に関する攻略サイトのスクリーンショットです。
画像から、記事づくりに使える要点だけを日本語で簡潔に抽出・要約してください。

重視するのは次の情報です:
- 狙い目のボーダー（設定変更後 / AT後 などのゲーム数）
- 期待値・機械割・出玉率などの数値
- モード / 天井 / 周期 / 有利区間などの仕様
- 示唆演出、やめ時、注意点

出力ルール:
- 箇条書きで、1項目1行。
- 数値は画像に書かれた通り正確に。読み取れない箇所は「(判読不可)」と書く。
- 画像に無い情報は推測で足さない。
- 前置き・あいさつは不要。要点だけ。`;

module.exports = async (req, res) => {
  if (req.method !== "POST") {
    res.status(405).json({ error: "POST only" });
    return;
  }
  try {
    const { media_type, image, kind } = req.body || {};
    if (!image || !media_type) {
      res.status(400).json({ error: "image と media_type が必要です" });
      return;
    }

    const apiKey = process.env.ANTHROPIC_API_KEY;
    // キー未設定なら、動作確認用のダミー要約を返す（デプロイ前でも画面が動く）
    if (!apiKey) {
      res.status(200).json({
        summary:
          "【ダミー要約：APIキー未設定】\n" +
          "・ここに、AIが画像から抜き出した狙い目・数値・示唆の要点が入ります。\n" +
          "・Vercelに ANTHROPIC_API_KEY を設定すると、本物のAI要約に切り替わります。\n" +
          `・受け取った種別: ${kind || "(未指定)"} / 形式: ${media_type}`,
      });
      return;
    }

    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 1024,
        messages: [
          {
            role: "user",
            content: [
              { type: "image", source: { type: "base64", media_type, data: image } },
              { type: "text", text: PROMPT(kind || "攻略情報") },
            ],
          },
        ],
      }),
    });

    const data = await r.json();
    if (!r.ok) {
      res.status(502).json({ error: (data.error && data.error.message) || "AI API エラー" });
      return;
    }
    const summary = (data.content || []).map((c) => c.text || "").join("\n").trim();
    res.status(200).json({ summary });
  } catch (e) {
    res.status(500).json({ error: String(e.message || e) });
  }
};
