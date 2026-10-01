// Servidor local para testar o app instalável no computador: http://localhost:8090
// (o navegador só instala o app e liga o modo offline em https ou em localhost)
//
// Rodar:  node servidor.mjs

import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const APP = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "app");
const TIPOS = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".json": "application/json", ".webmanifest": "application/manifest+json", ".png": "image/png", ".txt": "text/plain; charset=utf-8" };
const PORTA = 8090;
// o Marco (Claude, lugares, rotas) roda em servidor-marco/; sem ele, o app funciona e avisa que o Marco está desligado
const { tratarApi } = await import("../servidor-marco/api.mjs").catch((e) => { console.error("Marco desligado:", e.message); return { tratarApi: async () => false }; });

http.createServer(async (req, res) => {
  if (await tratarApi(req, res)) return;
  let p = decodeURIComponent(new URL(req.url, "http://x").pathname);
  // só para testes locais: o exemplo da Western (nunca publicado junto com o app)
  const t = p.match(/^\/__teste\/([\w.-]+\.json)$/);
  if (t) { const arq = path.join(APP, "..", "exemplos", t[1]); if (fs.existsSync(arq)) { res.writeHead(200, { "Content-Type": "application/json" }); fs.createReadStream(arq).pipe(res); } else { res.writeHead(404); res.end(); } return; }
  if (p.endsWith("/")) p += "index.html";
  const arq = path.join(APP, path.normalize(p));
  if (!arq.startsWith(APP) || !fs.existsSync(arq) || fs.statSync(arq).isDirectory()) { res.writeHead(404); res.end("não encontrado"); return; }
  res.writeHead(200, { "Content-Type": TIPOS[path.extname(arq)] || "application/octet-stream", "Cache-Control": "no-cache" });
  fs.createReadStream(arq).pipe(res);
}).listen(PORTA, () => console.log(`Clé em http://localhost:${PORTA}`));
