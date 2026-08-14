// ローカル確認用の簡易サーバー（本番はVercelがこの役割を担う）
const http = require("http");
const fs = require("fs");
const path = require("path");
const handler = require("./api/summarize.js");

const server = http.createServer(async (req, res) => {
  if (req.url === "/" || req.url === "/index.html") {
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    res.end(fs.readFileSync(path.join(__dirname, "index.html")));
    return;
  }
  if (req.url === "/api/summarize" && req.method === "POST") {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", async () => {
      req.body = body ? JSON.parse(body) : {};
      // Vercel風の res.status().json() を用意
      res.status = (code) => { res.statusCode = code; return res; };
      res.json = (obj) => { res.setHeader("content-type", "application/json"); res.end(JSON.stringify(obj)); };
      await handler(req, res);
    });
    return;
  }
  res.writeHead(404); res.end("not found");
});
server.listen(3000, () => console.log("http://localhost:3000"));
