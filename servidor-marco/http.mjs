// Rotas HTTP do Marco no padrão da web (Request → Response): o MESMO código roda no computador de testes
// (servidor-marco/api.mjs, Node) e na nuvem (supabase/functions/api, Deno). Quem chama injeta o que muda:
// variáveis de ambiente, o SDK da Anthropic, onde o consumo é guardado e o tempo máximo por pedido.
//
//   GET  …/estado    configuração, versão de cada modo, consumo de hoje, se o código de acesso vale
//   GET  …/consumo   consumo do dia e do mês, por modo
//   POST …/marco     { modo, historico, novas, contexto, dados, versao } → eventos (SSE) de um turno
//   POST …/ficha     { fala, hoje, quem } → ficha da viagem nova
//   POST …/resumir   { texto } → resumo para recomeçar uma conversa
//   POST …/rota      { pontos, modo } → { km, min, trechos, poly }
//   POST …/lugar     { consulta, perto, pais } → selo e ponto (caminho B)
//
// Acesso: na nuvem, cada testador tem um código (cabeçalho x-cle-acesso), definido no segredo TESTADORES
// ({"Wagner":"código", ...}). Sem código válido, nada que gaste créditos responde.

import { turnoMarco, fichaOnboarding, resumirConversa, MODOS, RECURSOS, CREDITOS_ACABARAM } from "./nucleo.mjs";
import { calcularRota } from "./rotas.mjs";
import { buscarLugar } from "./lugares.mjs";

const LIMITE_CORPO = 25 * 1024 * 1024; // comprovantes em PDF ou foto vão dentro da mensagem

export function criarApi({ env, Anthropic, consumo, prazoMs = 0, origens = [], exigirAcesso = false }) {
  const chaves = () => ({ MAPBOX_TOKEN: env("MAPBOX_TOKEN"), FOURSQUARE_API_KEY: env("FOURSQUARE_API_KEY"), NPS_API_KEY: env("NPS_API_KEY") });
  // trava de gasto (R12): vazio ou 0 = sem limite (desligada durante os testes, decisão de Wagner 01/10/2026)
  const limiteDia = () => { const v = +(env("LIMITE_DIARIO_USD") || 0); return v > 0 ? v : null; };
  const testadores = () => { try { return JSON.parse(env("TESTADORES") || "{}"); } catch { return {}; } };
  // quem é: o nome do testador cujo código confere (comparação sem atalho, para não vazar pelo tempo)
  const quemE = (codigo) => {
    if (!codigo) return null;
    for (const [nome, c] of Object.entries(testadores())) {
      if (typeof c !== "string" || c.length !== codigo.length) continue;
      let dif = 0; for (let i = 0; i < c.length; i++) dif |= c.charCodeAt(i) ^ codigo.charCodeAt(i);
      if (!dif) return nome;
    }
    return null;
  };

  return async function tratar(req) {
    const url = new URL(req.url);
    const rota = url.pathname.replace(/\/+$/, "").split("/").pop();
    const origem = req.headers.get("origin") || "";
    const cors = { "Access-Control-Allow-Origin": origens.includes(origem) ? origem : origens[0] || "*", "Access-Control-Allow-Headers": "content-type, x-cle-acesso", "Access-Control-Allow-Methods": "GET, POST, OPTIONS", Vary: "Origin" };
    const json = (status, obj) => new Response(JSON.stringify(obj), { status, headers: { ...cors, "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" } });
    if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });

    const quem = exigirAcesso ? quemE(req.headers.get("x-cle-acesso") || "") : "local";
    const lerCorpo = async () => { const t = await req.text(); if (t.length > LIMITE_CORPO) throw new Error("grande"); return JSON.parse(t || "{}"); };
    const prontoParaClaude = async () => {
      if (!Anthropic || !env("ANTHROPIC_API_KEY")) return { erro: json(503, { erro: "O Marco ainda não está configurado (falta a chave da Anthropic ou o pacote oficial)." }) };
      const lim = limiteDia();
      if (lim && (await consumo.ler()).hoje.usd >= lim) return { erro: json(429, { erro: `Limite de gasto do dia atingido (US$ ${lim.toFixed(2)}). O Marco volta amanhã; o resto do app continua funcionando.` }) };
      return { client: new Anthropic({ apiKey: env("ANTHROPIC_API_KEY") }) };
    };

    if (rota === "estado" && req.method === "GET") {
      const faltam = [];
      if (!Anthropic) faltam.push("pacote @anthropic-ai/sdk");
      if (!env("ANTHROPIC_API_KEY")) faltam.push("chave da Anthropic");
      if (!env("MAPBOX_TOKEN")) faltam.push("chave do Mapbox");
      if (!env("FOURSQUARE_API_KEY")) faltam.push("chave do Foursquare");
      if (!quem) return json(200, { marco: false, acesso: false, faltam: ["código de acesso válido"], versoes: {}, recursos: RECURSOS });
      const versoes = Object.fromEntries(Object.entries(MODOS).map(([k, m]) => [k, m.versao]));
      return json(200, { marco: !!(Anthropic && env("ANTHROPIC_API_KEY")), acesso: true, quem, rotas: !!env("MAPBOX_TOKEN"), faltam, versoes, recursos: RECURSOS, consumo: await consumo.ler() });
    }
    // daqui em diante tudo pode gastar créditos ou cotas: só com código válido
    if (!quem) return json(401, { erro: "Código de acesso ao Marco ausente ou inválido. Peça o seu ao Wagner e digite em Mais → Acesso ao Marco." });
    if (rota === "consumo" && req.method === "GET") return json(200, await consumo.ler());

    if (rota === "rota" && req.method === "POST") {
      try { const b = await lerCorpo(); return json(200, await calcularRota(b.pontos, b.modo, chaves())); } catch { return json(400, { erro: "Pedido inválido." }); }
    }
    if (rota === "lugar" && req.method === "POST") {
      try { const b = await lerCorpo(); if (!b.consulta) throw 0; return json(200, await buscarLugar(String(b.consulta), b.perto || null, chaves(), { pais: b.pais, forma: b.forma })); } catch { return json(400, { erro: "Pedido inválido." }); }
    }
    if ((rota === "ficha" || rota === "resumir") && req.method === "POST") {
      let b; try { b = await lerCorpo(); } catch { return json(400, { erro: "Pedido inválido." }); }
      const c = await prontoParaClaude(); if (c.erro) return c.erro;
      try {
        const r = rota === "ficha" ? await fichaOnboarding({ client: c.client, fala: String(b.fala || ""), hoje: b.hoje, quem: b.quem }) : await resumirConversa({ client: c.client, texto: String(b.texto || "") });
        await consumo.registrar(rota === "ficha" ? "ficha" : "resumo", r.consumo, quem);
        return json(200, r);
      } catch (e) { console.error("avulso:", e.message); return json(502, { erro: /credit balance|billing|insufficient/i.test(String(e.message)) ? CREDITOS_ACABARAM : "O Marco não conseguiu responder agora." }); }
    }

    if (rota === "marco" && req.method === "POST") {
      let b;
      try { b = await lerCorpo(); } catch (e) { return json(413, { erro: e.message === "grande" ? "Arquivo grande demais (máximo 25 MB)." : "Pedido inválido." }); }
      const continuacao = Array.isArray(b.novas) && !b.novas.length && Array.isArray(b.historico) && b.historico.length;
      if (!MODOS[b.modo] || !Array.isArray(b.historico) || !Array.isArray(b.novas) || (!b.novas.length && !continuacao)) return json(400, { erro: "Pedido inválido." });
      // R1: conversa criada com outra versão do prefixo não é reenviada (seria recusada); o app recomeça com resumo
      if (b.versao && b.versao !== MODOS[b.modo].versao && b.historico.length) return json(409, { erro: "versao", versao: MODOS[b.modo].versao });
      const c = await prontoParaClaude(); if (c.erro) return c.erro;
      const enc = new TextEncoder();
      const corpo = new ReadableStream({
        async start(ctrl) {
          const enviar = (ev) => { try { ctrl.enqueue(enc.encode("data: " + JSON.stringify(ev) + "\n\n")); } catch { /* app fechou a conexão */ } };
          let ultimo = null;
          enviar({ tipo: "inicio", versao: MODOS[b.modo].versao, modelo: MODOS[b.modo].modelo });
          try {
            for await (const ev of turnoMarco({ client: c.client, modo: b.modo, historico: b.historico, novas: b.novas, contexto: b.contexto, dados: b.dados, chaves: chaves(), Anthropic, prazoMs })) {
              if (ev.consumo) ultimo = ev.consumo;
              enviar(ev);
            }
          } catch (e) { console.error("marco:", e.message); enviar({ tipo: "erro", mensagem: "Falha no servidor do Marco." }); }
          try { await consumo.registrar(b.modo, ultimo, quem); } catch (e) { console.error("consumo:", e.message); }
          try { ctrl.close(); } catch { /* já fechada */ }
        },
      });
      return new Response(corpo, { headers: { ...cors, "Content-Type": "text/event-stream; charset=utf-8", "Cache-Control": "no-store" } });
    }

    return json(404, { erro: "não encontrado" });
  };
}

// soma de linhas de consumo (usada pelos dois armazenamentos: arquivo local e banco na nuvem)
export function resumirConsumo(linhas, limiteDiaUsd) {
  const hoje = new Date().toISOString().slice(0, 10);
  const soma = (ls) => ls.reduce((a, x) => ({ usd: a.usd + (+x.usd || 0), chamadas: a.chamadas + (x.chamadas || 0), entrada: a.entrada + (x.entrada || 0), cacheLido: a.cacheLido + (x.cacheLido || 0), cacheEscrito: a.cacheEscrito + (x.cacheEscrito || 0), saida: a.saida + (x.saida || 0), buscas: a.buscas + (x.buscas || 0), turnos: a.turnos + 1 }), { usd: 0, chamadas: 0, entrada: 0, cacheLido: 0, cacheEscrito: 0, saida: 0, buscas: 0, turnos: 0 });
  const porModo = {}; for (const m of new Set(linhas.map((x) => x.modo))) porModo[m] = soma(linhas.filter((x) => x.modo === m));
  const porPessoa = {}; for (const p of new Set(linhas.map((x) => x.quem).filter(Boolean))) porPessoa[p] = soma(linhas.filter((x) => x.quem === p));
  return { hoje: soma(linhas.filter((x) => String(x.quando).slice(0, 10) === hoje)), mes: soma(linhas), porModo, porPessoa, limiteDiaUsd };
}
