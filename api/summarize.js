// Vercel Serverless Function:  POST /api/summarize
// 入力: { mode: "image" | "url" | "text", ... } → 出力: { summary }
//   mode:"image" … { media_type, image(base64), kind }
//   mode:"url"   … { url, kind }        ※ログイン不要の公開ページ用
//   mode:"text"  … { text, kind }       ※会員ページはブラウザでコピーして貼る
// APIキーは環境変数 ANTHROPIC_API_KEY、モデルは ANTHROPIC_MODEL で変更可

const MODEL = process.env.ANTHROPIC_MODEL || "claude-sonnet-5";
const MAX_TEXT = 60000; // 長すぎるページの安全弁（文字数）

const PROMPT = (kind) => `あなたはパチスロ攻略記事の編集アシスタントです。
これは「${kind}」に関する攻略情報です。
記事づくりに使える要点だけを日本語で簡潔に抽出・要約してください。

重視するのは次の情報です:
- 狙い目のボーダー（設定変更後 / AT後 などのゲーム数）
- 期待値・機械割・出玉率などの数値
- モード / 天井 / 周期 / 有利区間などの仕様
- 示唆演出、やめ時、注意点

出力ルール:
- 箇条書きで、1項目1行。
- 数値は元の情報の通り正確に。読み取れない箇所は「(判読不可)」と書く。
- 元に無い情報は推測で足さない。
- 前置き・あいさつは不要。要点だけ。`;

// ページのHTMLから本文テキストをざっくり抽出
function htmlToText(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|tr|li|h[1-6]|table|section|article)>/gi, "\n")
    .replace(/<td[^>]*>/gi, " | ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s*\n\s*/g, "\n")
    .trim();
}

module.exports = async (req, res) => {
  if (req.method !== "POST") { res.status(405).json({ error: "POST only" }); return; }
  try {
    const body = req.body || {};
    const kind = body.kind || "攻略情報";
    const mode = body.mode || (body.image ? "image" : body.url ? "url" : "text");
    const apiKey = process.env.ANTHROPIC_API_KEY;

    // ---- 入力を1つの content 配列に組み立てる ----
    let content;
    if (mode === "image") {
      if (!body.image || !body.media_type) { res.status(400).json({ error: "画像がありません" }); return; }
      content = [
        { type: "image", source: { type: "base64", media_type: body.media_type, data: body.image } },
        { type: "text", text: PROMPT(kind) },
      ];
    } else if (mode === "url") {
      if (!body.url || !/^https?:\/\//.test(body.url)) { res.status(400).json({ error: "URLが正しくありません" }); return; }
      let pageText;
      try {
        const pr = await fetch(body.url, {
          headers: { "user-agent": "Mozilla/5.0 (compatible; NeraiApp/1.0)" },
          redirect: "follow",
        });
        if (!pr.ok) { res.status(502).json({ error: `ページ取得に失敗（HTTP ${pr.status}）` }); return; }
        pageText = htmlToText(await pr.text());
      } catch (e) {
        res.status(502).json({ error: "ページ取得に失敗: " + String(e.message || e) }); return;
      }
      if (!pageText || pageText.length < 100) {
        res.status(422).json({ error: "本文をほとんど取得できませんでした（会員限定ページの可能性）。ログインが必要なページは「テキスト貼り付け」を使ってください。" });
        return;
      }
      if (/(有料会員限定|会員限定|ログインする事で|ログインしてください)/.test(pageText) && pageText.length < 1000) {
        res.status(422).json({ error: "会員限定ページのようです。ログイン済みブラウザでページを全選択コピーして「テキスト貼り付け」を使ってください。" });
        return;
      }
      content = [{ type: "text", text: `以下はWebページ（${body.url}）の本文テキストです。\n\n${pageText.slice(0, MAX_TEXT)}\n\n---\n${PROMPT(kind)}` }];
    } else {
      if (!body.text || body.text.trim().length < 20) { res.status(400).json({ error: "テキストが短すぎます" }); return; }
      content = [{ type: "text", text: `以下は攻略ページから貼り付けたテキストです。\n\n${body.text.slice(0, MAX_TEXT)}\n\n---\n${PROMPT(kind)}` }];
    }

    // ---- キー未設定ならダミー（動作確認用） ----
    if (!apiKey) {
      res.status(200).json({ summary: `【ダミー要約：APIキー未設定】\n・mode=${mode} / 種別=${kind} を受け取りました。\n・Vercelに ANTHROPIC_API_KEY を設定すると本物のAI要約になります。` });
      return;
    }

    // ---- Anthropic API 呼び出し ----
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "x-api-key": apiKey, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({ model: MODEL, max_tokens: 1500, messages: [{ role: "user", content }] }),
    });
    const data = await r.json();
    if (!r.ok) { res.status(502).json({ error: (data.error && data.error.message) || "AI APIエラー" }); return; }
    const summary = (data.content || []).map((c) => c.text || "").join("\n").trim();
    res.status(200).json({ summary });
  } catch (e) {
    res.status(500).json({ error: String(e.message || e) });
  }
};
