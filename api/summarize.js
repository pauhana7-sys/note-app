// Vercel Serverless Function:  POST /api/summarize
// task で処理を切り替える:
//   "summarize" … 材料の要約 { mode:"image"|"url"|"text", ... , kind }
//   "candidates" … 狙い目候補の生成 { machine, summaries:[..] }
//   "write" … 本文執筆 { machine, section:"red"|"green"|"yellow"|"other", sectionTitle, points, picked:[..], summaries:[..] }
//   "matome" … まとめ { machine, bodies:{red,green,yellow,other} }
//   "lead" … 有料冒頭の要約 { machine, picked:[..], bodies:{..} }
//   "intro" … 無料の導入 { machine, picked:[..], matome }
// APIキー: 環境変数 ANTHROPIC_API_KEY ／ モデル: ANTHROPIC_MODEL（既定 claude-sonnet-5）

const MODEL = process.env.ANTHROPIC_MODEL || "claude-sonnet-5";
const MAX_TEXT = 60000;

module.exports.config = { maxDuration: 60 };

const STYLE = `
文体ルール（厳守）:
- ですます調で統一する（言い切り・体言止めと混在させない）。
- 1〜2文ごとに改行し、段落と段落の間には空行を1行入れる。
- 重要な部分は **太字** で強調する（マークは ** で囲む）。
- 他の攻略サイト名や他者の造語（けんけん、けんけんポイント、VALO、げんぱち、GENPACHI、すろらぼ、ちょんぼりすた など）は本文に一切書かない。一般的な言葉に言い換える。
- 「解析で判明している事実」「実戦データの傾向」「本人の考察」を区別し、推測は「〜と考えています」「〜の可能性があります」と表現する。断定しない。
- 読者は基本的なハイエナ知識を持つ兼業サラリーマン。専門用語だけにせず、分かりにくい仕組みはたまに日常の例えでかみ砕く。
- 負け層を煽る表現（「負け組から脱却」等）は使わない。落ち着いた分析的な語り口。
- 前置きやあいさつは書かない。本文だけを出力する。`;

const SUMMARIZE_PROMPT = (kind) => `あなたはパチスロ攻略記事の編集アシスタントです。
これは「${kind}」に関する攻略情報です。
（画像が複数ある場合は、1つの縦長ページを上から順に分割したものです。全体を通して読んでください。）
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

const joinSummaries = (arr) => (arr || []).map((s, i) => `【材料${i + 1}】\n${s}`).join("\n\n").slice(0, MAX_TEXT);
const pickedText = (picked) => (picked || []).map((c) => `${c.mark} ${c.title}｜${c.border || ""}｜${c.note || ""}`).join("\n");

async function callClaude(apiKey, content, maxTokens) {
  const r = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "x-api-key": apiKey, "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify({ model: MODEL, max_tokens: maxTokens, messages: [{ role: "user", content }] }),
  });
  const data = await r.json();
  if (!r.ok) throw new Error((data.error && data.error.message) || "AI APIエラー");
  return (data.content || []).map((c) => c.text || "").join("\n").trim();
}

module.exports = async (req, res) => {
  if (req.method !== "POST") { res.status(405).json({ error: "POST only" }); return; }
  try {
    const body = req.body || {};
    const task = body.task || "summarize";
    const apiKey = process.env.ANTHROPIC_API_KEY;
    const machine = body.machine || "この機種";

    // ---------- 材料の要約 ----------
    if (task === "summarize") {
      const kind = body.kind || "攻略情報";
      const mode = body.mode || (body.images || body.image ? "image" : body.url ? "url" : "text");
      let content;

      if (mode === "image") {
        const imgs = Array.isArray(body.images) && body.images.length
          ? body.images
          : (body.image && body.media_type ? [{ media_type: body.media_type, data: body.image }] : []);
        if (!imgs.length) { res.status(400).json({ error: "画像がありません" }); return; }
        if (imgs.length > 20) { res.status(400).json({ error: "分割数が多すぎます（20枚まで）" }); return; }
        content = [
          ...imgs.map((im) => ({ type: "image", source: { type: "base64", media_type: im.media_type, data: im.data } })),
          { type: "text", text: SUMMARIZE_PROMPT(kind) },
        ];
      } else if (mode === "url") {
        if (!body.url || !/^https?:\/\//.test(body.url)) { res.status(400).json({ error: "URLが正しくありません" }); return; }
        let pageText;
        try {
          const pr = await fetch(body.url, { headers: { "user-agent": "Mozilla/5.0 (compatible; NeraiApp/1.0)" }, redirect: "follow" });
          if (!pr.ok) { res.status(502).json({ error: `ページ取得に失敗（HTTP ${pr.status}）` }); return; }
          pageText = htmlToText(await pr.text());
        } catch (e) { res.status(502).json({ error: "ページ取得に失敗: " + String(e.message || e) }); return; }
        if (!pageText || pageText.length < 100) {
          res.status(422).json({ error: "本文をほとんど取得できませんでした（会員限定ページの可能性）。「テキスト貼り付け」を使ってください。" }); return;
        }
        if (/(有料会員限定|会員限定|ログインする事で|ログインしてください)/.test(pageText) && pageText.length < 1000) {
          res.status(422).json({ error: "会員限定ページのようです。ログイン済みブラウザで全選択コピーして「テキスト貼り付け」を使ってください。" }); return;
        }
        content = [{ type: "text", text: `以下はWebページ（${body.url}）の本文テキストです。\n\n${pageText.slice(0, MAX_TEXT)}\n\n---\n${SUMMARIZE_PROMPT(kind)}` }];
      } else {
        if (!body.text || body.text.trim().length < 20) { res.status(400).json({ error: "テキストが短すぎます" }); return; }
        content = [{ type: "text", text: `以下は攻略ページから貼り付けたテキストです。\n\n${body.text.slice(0, MAX_TEXT)}\n\n---\n${SUMMARIZE_PROMPT(kind)}` }];
      }

      if (!apiKey) {
        const nImg = content.filter((c) => c.type === "image").length;
        res.status(200).json({ summary: `【ダミー要約：APIキー未設定】\n・mode=${mode} / 画像${nImg}枚 を受け取りました。` }); return;
      }
      const summary = await callClaude(apiKey, content, 1500);
      res.status(200).json({ summary }); return;
    }

    if (!apiKey) { res.status(200).json({ summary: "【ダミー：APIキー未設定】task=" + task }); return; }

    // ---------- 狙い目候補 ----------
    if (task === "candidates") {
      const prompt = `あなたはパチスロ攻略記事の編集アシスタントです。
機種「${machine}」について、以下の材料要約から「狙い目候補」を洗い出してください。

${joinSummaries(body.summaries)}

出力ルール:
- 必ずJSON配列のみを出力する。説明文・前置きは一切書かない。
- 形式: [{"title":"狙い目の名前(簡潔に)","border":"条件とボーダー(例: 設定変更後220G〜)","note":"一言補足(何が甘いのか)"}]
- 期待値・機械割が高い順に並べる。5〜10件。
- 他サイト名・他者の造語は使わない（一般名詞に言い換える）。`;
      const raw = await callClaude(apiKey, [{ type: "text", text: prompt }], 2000);
      let candidates;
      try {
        const m = raw.match(/\[[\s\S]*\]/);
        candidates = JSON.parse(m ? m[0] : raw);
      } catch { res.status(200).json({ candidates: null, raw }); return; }
      res.status(200).json({ candidates }); return;
    }

    // ---------- 本文執筆 ----------
    if (task === "write") {
      const secName = { red: "🔴 最も伝えたい狙い目", green: "🟢 2番目に伝えたい狙い目", yellow: "🟡 3番目に伝えたい狙い目", other: "その他、網羅的に押さえたい狙い目" }[body.section] || "本文";
      const mark = { red: "🔴", green: "🟢", yellow: "🟡", other: "◆" }[body.section] || "◆";
      const depth = body.section === "other"
        ? "ここは深掘りせず、各狙い目を「条件とボーダーだけサッと」箇条書き中心で簡潔にまとめる。"
        : "「まず結論から」→ 条件とボーダー → なぜ甘いのか（仕組み・データ・考察を順に噛み砕く）→「だから、こう狙う」の流れで、初心者にも分かるよう丁寧に書く。";
      const prompt = `あなたはパチスロ攻略記事のライターです。
機種「${machine}」の記事の「${secName}」セクションの本文を書いてください。

対象の狙い目:
${body.sectionTitle || "(下の候補一覧から該当するもの)"}

採用が決まっている狙い目一覧:
${pickedText(body.picked)}

執筆者からの強調ポイント・指示:
${body.points || "(特になし)"}

参考材料（要約）:
${joinSummaries(body.summaries)}

構成の指示:
- ${depth}
- 小見出しを付ける場合は行頭を「${mark} 」で始める（◆は使わない。ただしその他セクションは◆でよい）。
- セクションの大見出し（# など）は書かない。本文から始める。
${STYLE}`;
      const bodyText = await callClaude(apiKey, [{ type: "text", text: prompt }], 3000);
      res.status(200).json({ body: bodyText }); return;
    }

    // ---------- まとめ ----------
    if (task === "matome") {
      const b = body.bodies || {};
      const prompt = `あなたはパチスロ攻略記事のライターです。
機種「${machine}」の記事の「まとめ」を書いてください。

本文（🔴）: ${String(b.red || "").slice(0, 6000)}
本文（🟢）: ${String(b.green || "").slice(0, 6000)}
本文（🟡）: ${String(b.yellow || "").slice(0, 6000)}

指示:
- 新しい情報は足さない。🔴🟢🟡それぞれを「何を狙うか／どこから打つか／やめ・注意」で簡潔に振り返る。
- 最後に、記事全体を貫く考え方を1〜2文で締める。
${STYLE}`;
      const t = await callClaude(apiKey, [{ type: "text", text: prompt }], 2000);
      res.status(200).json({ body: t }); return;
    }

    // ---------- 有料冒頭の要約 ----------
    if (task === "lead") {
      const b = body.bodies || {};
      const prompt = `あなたはパチスロ攻略記事のライターです。
機種「${machine}」の有料パート冒頭に置く「要点まとめ」を書いてください。
読者が全部読まなくても、ここだけで実践できる密度にします。

採用した狙い目一覧:
${pickedText(body.picked)}

本文の要旨: ${String(b.red || "").slice(0, 3000)}\n${String(b.green || "").slice(0, 2000)}\n${String(b.yellow || "").slice(0, 2000)}

指示:
- 冒頭に「まずは今回の狙い目を、要点だけ先にまとめておきます。」の趣旨の一文。
- 🔴🟢🟡それぞれの条件・ボーダー・押さえ所を箇条書きで簡潔に。
- 最後に「ここから本文では、なぜこの条件だと甘いのかを順番に解説していきます」の趣旨で本文へ誘導。
${STYLE}`;
      const t = await callClaude(apiKey, [{ type: "text", text: prompt }], 2000);
      res.status(200).json({ body: t }); return;
    }

    // ---------- 無料の導入 ----------
    if (task === "intro") {
      const prompt = `あなたはパチスロ攻略記事のライターです。
機種「${machine}」の記事の「無料の導入部分」を書いてください。全読者が読む部分です。

採用した狙い目一覧（核心はぼかすための参考。具体的な数値・条件は本文で明かすので導入には書かない）:
${pickedText(body.picked)}

まとめの要旨: ${String(body.matome || "").slice(0, 3000)}

指示:
- 書き出しは「こんにちは、兼業リーマンスロッター ナツヤです！」。
- 読者の「あるある」→ それは運ではなく打つ前に見分けられる、という提起 → 兼業ならではの視点 → この記事で分かること、の流れ。
- 具体的なボーダー数値や条件の核心は伏せる。ただし興味を引く固有の呼び名（例:「◯◯フラグ」のような本人の仮説名）は1つだけ匂わせてよい。
- 煽らない。落ち着いた分析的な語り口で、続きを読みたくさせる。
${STYLE}`;
      const t = await callClaude(apiKey, [{ type: "text", text: prompt }], 2000);
      res.status(200).json({ body: t }); return;
    }

    res.status(400).json({ error: "不明なtask: " + task });
  } catch (e) {
    res.status(500).json({ error: String(e.message || e) });
  }
};
