// Rotas HTTP do Marco para o servidor local (Node). Na nuvem (Supabase) o mesmo núcleo é chamado por uma Edge Function.
//   GET  /api/estado    o que está configurado, versão de cada modo, consumo de hoje (sem revelar chaves)
//   GET  /api/consumo   consumo do dia e do mês, por modo
//   POST /api/marco     { modo, historico, novas, contexto, dados } → eventos (SSE) de um turno
//   POST /api/ficha     { fala, hoje, quem } → ficha da viagem nova (Sonnet, esforço baixo)
//   POST /api/resumir   { texto } → resumo para recomeçar uma conversa (Sonnet, esforço baixo)
//   POST /api/rota      { pontos, modo } → { km, min, trechos, poly }
//   POST /api/lugar     { consulta, perto, pais } → selo e ponto (caminho B)
// Chaves em servidor-marco/.env (nunca publicado). Consumo em servidor-marco/consumo/ (nunca publicado; só números).

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { turnoMarco, fichaOnboarding, resumirConversa, MODOS, RECURSOS, CREDITOS_ACABARAM } from "./nucleo.mjs";
import { calcularRota } from "./rotas.mjs";
import { buscarLugar } from "./lugares.mjs";

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const ENV = path.join(AQUI, ".env");
if (fs.existsSync(ENV)) process.loadEnvFile(ENV);
const chaves = () => ({ MAPBOX_TOKEN: process.env.MAPBOX_TOKEN, FOURSQUARE_API_KEY: process.env.FOURSQUARE_API_KEY, NPS_API_KEY: process.env.NPS_API_KEY });
// trava de gasto (regra de contexto, R12): acima do limite do dia, o Marco para até o dia seguinte.
// DESLIGADA por decisão de Wagner (01/10/2026) durante os testes intensivos: vazio ou 0 = sem limite (o consumo continua medido)
const LIMITE_DIA = () => { const v = +(process.env.LIMITE_DIARIO_USD || 0); return v > 0 ? v : null; };

let sdk = null;
async function carregarSdk() {
  if (sdk) return sdk;
  try { const m = await import("@anthropic-ai/sdk"); sdk = m.default || m.Anthropic; return sdk; } catch { return null; }
}

// ---------- consumo: uma linha por turno, só números (sem conteúdo da conversa) ----------
const DIR_CONSUMO = path.join(AQUI, "consumo");
const hoje = () => new Date().toISOString().slice(0, 10);
const arqMes = (d = hoje()) => path.join(DIR_CONSUMO, d.slice(0, 7) + ".jsonl");
function registrarConsumo(modo, c) {
  if (!c || !c.chamadas) return;
  fs.mkdirSync(DIR_CONSUMO, { recursive: true });
  fs.appendFileSync(arqMes(), JSON.stringify({ quando: new Date().toISOString(), modo, ...c, usd: +c.usd.toFixed(5) }) + "\n");
}
function lerConsumo() {
  const linhas = fs.existsSync(arqMes()) ? fs.readFileSync(arqMes(), "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l)) : [];
  const soma = (ls) => ls.reduce((a, x) => ({ usd: a.usd + x.usd, chamadas: a.chamadas + x.chamadas, entrada: a.entrada + x.entrada, cacheLido: a.cacheLido + x.cacheLido, cacheEscrito: a.cacheEscrito + x.cacheEscrito, saida: a.saida + x.saida, buscas: a.buscas + x.buscas, turnos: a.turnos + 1 }), { usd: 0, chamadas: 0, entrada: 0, cacheLido: 0, cacheEscrito: 0, saida: 0, buscas: 0, turnos: 0 });
  const doDia = linhas.filter((x) => x.quando.slice(0, 10) === hoje());
  const porModo = {}; for (const m of new Set(linhas.map((x) => x.modo))) porModo[m] = soma(linhas.filter((x) => x.modo === m));
  return { hoje: soma(doDia), mes: soma(linhas), porModo, limiteDiaUsd: LIMITE_DIA() };
}

const LIMITE = 25 * 1024 * 1024; // comprovantes em PDF ou foto vão dentro da mensagem
function lerCorpo(req) {
  return new Promise((ok, falha) => {
    let n = 0; const partes = [];
    req.on("data", (c) => { n += c.length; if (n > LIMITE) { falha(new Error("grande")); req.destroy(); } else partes.push(c); });
    req.on("end", () => { try { ok(JSON.parse(Buffer.concat(partes).toString("utf8") || "{}")); } catch (e) { falha(e); } });
    req.on("error", falha);
  });
}
const json = (res, status, obj) => { res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" }); res.end(JSON.stringify(obj)); };
async function prontoParaClaude(res) {
  const Anthropic = await carregarSdk();
  if (!Anthropic || !process.env.ANTHROPIC_API_KEY) { json(res, 503, { erro: "O Marco ainda não está configurado neste computador (falta a chave da Anthropic ou o pacote oficial)." }); return null; }
  if (LIMITE_DIA() && lerConsumo().hoje.usd >= LIMITE_DIA()) { json(res, 429, { erro: `Limite de gasto do dia atingido (US$ ${LIMITE_DIA().toFixed(2)}). O Marco volta amanhã; o resto do app continua funcionando.` }); return null; }
  return { Anthropic, client: new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY }) };
}

/** Devolve true se a requisição era da API (e já foi respondida). */
export async function tratarApi(req, res) {
  const p = new URL(req.url, "http://x").pathname;
  if (!p.startsWith("/api/")) return false;

  if (p === "/api/estado" && req.method === "GET") {
    const Anthropic = await carregarSdk();
    const faltam = [];
    if (!Anthropic) faltam.push("pacote @anthropic-ai/sdk");
    if (!process.env.ANTHROPIC_API_KEY) faltam.push("chave da Anthropic");
    if (!process.env.MAPBOX_TOKEN) faltam.push("chave do Mapbox");
    if (!process.env.FOURSQUARE_API_KEY) faltam.push("chave do Foursquare");
    const versoes = Object.fromEntries(Object.entries(MODOS).map(([k, m]) => [k, m.versao]));
    json(res, 200, { marco: !!(Anthropic && process.env.ANTHROPIC_API_KEY), rotas: !!process.env.MAPBOX_TOKEN, faltam, versoes, recursos: RECURSOS, consumo: lerConsumo() });
    return true;
  }
  if (p === "/api/consumo" && req.method === "GET") { json(res, 200, lerConsumo()); return true; }

  if (p === "/api/rota" && req.method === "POST") {
    try { const b = await lerCorpo(req); json(res, 200, await calcularRota(b.pontos, b.modo, chaves())); }
    catch { json(res, 400, { erro: "Pedido inválido." }); }
    return true;
  }
  // busca direta de lugares (tela Desejos), sem passar pelo Claude
  if (p === "/api/lugar" && req.method === "POST") {
    try { const b = await lerCorpo(req); if (!b.consulta) throw 0; json(res, 200, await buscarLugar(String(b.consulta), b.perto || null, chaves(), { pais: b.pais, forma: b.forma })); }
    catch { json(res, 400, { erro: "Pedido inválido." }); }
    return true;
  }

  if ((p === "/api/ficha" || p === "/api/resumir") && req.method === "POST") {
    let b; try { b = await lerCorpo(req); } catch { json(res, 400, { erro: "Pedido inválido." }); return true; }
    const c = await prontoParaClaude(res); if (!c) return true;
    try {
      const r = p === "/api/ficha" ? await fichaOnboarding({ client: c.client, fala: String(b.fala || ""), hoje: b.hoje, quem: b.quem }) : await resumirConversa({ client: c.client, texto: String(b.texto || "") });
      registrarConsumo(p === "/api/ficha" ? "ficha" : "resumo", r.consumo);
      json(res, 200, r);
    } catch (e) { console.error("avulso:", e.message); json(res, 502, { erro: /credit balance|billing|insufficient/i.test(String(e.message)) ? CREDITOS_ACABARAM : "O Marco não conseguiu responder agora." }); }
    return true;
  }

  if (p === "/api/marco" && req.method === "POST") {
    let b;
    try { b = await lerCorpo(req); } catch (e) { json(res, 413, { erro: e.message === "grande" ? "Arquivo grande demais (máximo 25 MB)." : "Pedido inválido." }); return true; }
    if (!MODOS[b.modo] || !Array.isArray(b.historico) || !Array.isArray(b.novas) || !b.novas.length) { json(res, 400, { erro: "Pedido inválido." }); return true; }
    // R1: conversa criada com outra versão do prefixo não é reenviada (seria recusada); o app recomeça com resumo
    if (b.versao && b.versao !== MODOS[b.modo].versao && b.historico.length) { json(res, 409, { erro: "versao", versao: MODOS[b.modo].versao }); return true; }
    const c = await prontoParaClaude(res); if (!c) return true;
    res.writeHead(200, { "Content-Type": "text/event-stream; charset=utf-8", "Cache-Control": "no-store", Connection: "keep-alive" });
    let fechado = false, ultimo = null;
    req.on("close", () => { fechado = true; });
    res.write("data: " + JSON.stringify({ tipo: "inicio", versao: MODOS[b.modo].versao, modelo: MODOS[b.modo].modelo }) + "\n\n");
    try {
      for await (const ev of turnoMarco({ client: c.client, modo: b.modo, historico: b.historico, novas: b.novas, contexto: b.contexto, dados: b.dados, chaves: chaves(), Anthropic: c.Anthropic })) {
        if (ev.consumo) ultimo = ev.consumo;
        if (!fechado) res.write("data: " + JSON.stringify(ev) + "\n\n");
      }
    } catch (e) {
      if (!fechado) res.write("data: " + JSON.stringify({ tipo: "erro", mensagem: "Falha no servidor do Marco." }) + "\n\n");
      console.error("marco:", e.message);
    }
    registrarConsumo(b.modo, ultimo);
    res.end();
    return true;
  }

  json(res, 404, { erro: "não encontrado" });
  return true;
}
