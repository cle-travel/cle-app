// O Marco no computador de testes (Node): adapta as rotas padrão da web (http.mjs) ao servidor local.
// Na nuvem, o mesmo http.mjs roda numa Edge Function do Supabase (supabase/functions/api).
// Chaves em servidor-marco/.env (nunca publicado). Consumo em servidor-marco/consumo/ (nunca publicado; só números).

import fs from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";
import { fileURLToPath } from "node:url";
import { criarApi, resumirConsumo } from "./http.mjs";

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const ENV = path.join(AQUI, ".env");
if (fs.existsSync(ENV)) process.loadEnvFile(ENV);

let Anthropic = null;
try { const m = await import("@anthropic-ai/sdk"); Anthropic = m.default || m.Anthropic; } catch { /* sem o pacote, o app avisa */ }

// consumo em arquivo: uma linha por turno, só números (sem conteúdo da conversa)
const DIR = path.join(AQUI, "consumo");
const arqMes = () => path.join(DIR, new Date().toISOString().slice(0, 7) + ".jsonl");
const consumo = {
  async registrar(modo, c, quem) {
    if (!c || !c.chamadas) return;
    fs.mkdirSync(DIR, { recursive: true });
    fs.appendFileSync(arqMes(), JSON.stringify({ quando: new Date().toISOString(), modo, quem, ...c, usd: +c.usd.toFixed(5) }) + "\n");
  },
  async ler() {
    const linhas = fs.existsSync(arqMes()) ? fs.readFileSync(arqMes(), "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l)) : [];
    const v = +(process.env.LIMITE_DIARIO_USD || 0);
    return resumirConsumo(linhas, v > 0 ? v : null);
  },
};

const PORTA = +(process.env.PORTA || 8090);
const tratar = criarApi({ env: (k) => process.env[k], Anthropic, consumo, prazoMs: 0, origens: [`http://localhost:${PORTA}`], exigirAcesso: false });

/** Devolve true se a requisição era da API (e já foi respondida). */
export async function tratarApi(req, res) {
  if (!req.url.startsWith("/api/")) return false;
  const temCorpo = req.method !== "GET" && req.method !== "HEAD";
  const pedido = new Request("http://localhost" + req.url, { method: req.method, headers: req.headers, body: temCorpo ? Readable.toWeb(req) : undefined, duplex: "half" });
  const resp = await tratar(pedido);
  res.writeHead(resp.status, Object.fromEntries(resp.headers));
  if (resp.body) Readable.fromWeb(resp.body).pipe(res); else res.end();
  return true;
}
