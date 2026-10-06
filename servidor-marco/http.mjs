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
// Acesso na nuvem: pela CONTA do viajante (login do Supabase, cabeçalho Authorization) cujo e-mail está no segredo
// PERMITIDOS ({"Wagner":"email", ...}), ou, na transição, pelo código do testador (x-cle-acesso, segredo TESTADORES).
// Sem um dos dois, nada que gaste créditos responde.

import { turnoMarco, fichaOnboarding, resumirConversa, MODOS, RECURSOS, CREDITOS_ACABARAM } from "./nucleo.mjs";
import { calcularRota } from "./rotas.mjs";
import { buscarLugar } from "./lugares.mjs";

const VOZ_MARCO = { id: "cjVigY5qzO86Huf0OWal", nome: "Eric", modelo: "eleven_v4_turbo" };
const ANCORA_BR = "Oi, tudo bem? Aqui é o Marco, do Clé. Bora planejar essa viagem juntos, do jeitinho brasileiro.";
const LIMITE_CORPO = 25 * 1024 * 1024; // comprovantes em PDF ou foto vão dentro da mensagem

// "Bearer <token>" → "<token>" (exportada para o teste automático em prototipo/testar.mjs)
export const tokenDoCabecalho = (cabecalho) => String(cabecalho || "").replace(/^Bearer\s+/i, "").trim();

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

  // conta do Supabase: confere o token com o próprio Supabase e procura o e-mail na lista de liberados (cache de 5 min)
  const liberados = () => { try { return Object.fromEntries(Object.entries(JSON.parse(env("PERMITIDOS") || "{}")).map(([n, e]) => [String(e).trim().toLowerCase(), n])); } catch { return {}; } };
  const cacheContas = new Map(), cacheFotos = new Map();
  const quemPelaConta = async (cabecalho) => {
    const t = tokenDoCabecalho(cabecalho);
    if (!t || !env("SUPABASE_URL")) return { quem: null, motivo: "sem_conta" };
    const c = cacheContas.get(t); if (c && c.ate > Date.now()) return c.r;
    let r = { quem: null, motivo: "conta_invalida" };
    try {
      const resp = await fetch(env("SUPABASE_URL") + "/auth/v1/user", { headers: { apikey: env("SUPABASE_SERVICE_ROLE_KEY") || env("SUPABASE_ANON_KEY"), Authorization: "Bearer " + t } });
      if (resp.ok) {
        const u = await resp.json(); const nome = liberados()[String(u.email || "").toLowerCase()];
        r = nome ? { quem: nome } : { quem: null, motivo: "conta_nao_liberada" };
        // só guarda respostas confirmadas pelo Supabase; falha de rede ou token recusado não ficam presos no cache
        if (cacheContas.size > 500) cacheContas.clear();
        cacheContas.set(t, { r, ate: Date.now() + 5 * 60 * 1000 });
      }
    } catch { r = { quem: null, motivo: "conta_indisponivel" }; }
    return r;
  };

  return async function tratar(req) {
    const url = new URL(req.url);
    const rota = url.pathname.replace(/\/+$/, "").split("/").pop();
    const origem = req.headers.get("origin") || "";
    const cors = { "Access-Control-Allow-Origin": origens.includes(origem) ? origem : origens[0] || "*", "Access-Control-Allow-Headers": "content-type, x-cle-acesso, authorization, x-duracao-ms", "Access-Control-Allow-Methods": "GET, POST, OPTIONS", Vary: "Origin" };
    const json = (status, obj) => new Response(JSON.stringify(obj), { status, headers: { ...cors, "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" } });
    if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });

    let quem = "local", motivo = null;
    if (exigirAcesso) { quem = quemE(req.headers.get("x-cle-acesso") || ""); if (!quem) ({ quem, motivo } = await quemPelaConta(req.headers.get("authorization"))); }
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
      if (!quem) return json(200, { marco: false, acesso: false, motivo, faltam: [motivo === "conta_nao_liberada" ? "conta liberada para o Marco" : "conta ou código de acesso"], versoes: {}, recursos: RECURSOS });
      const versoes = Object.fromEntries(Object.entries(MODOS).map(([k, m]) => [k, m.versao]));
      return json(200, { marco: !!(Anthropic && env("ANTHROPIC_API_KEY")), acesso: true, quem, rotas: !!env("MAPBOX_TOKEN"), voz: !!env("ELEVENLABS_API_KEY"), faltam, versoes, recursos: RECURSOS, consumo: await consumo.ler() });
    }
    // daqui em diante tudo pode gastar créditos ou cotas: só com código válido
    if (!quem) return json(401, { erro: motivo === "conta_nao_liberada" ? "Sua conta ainda não foi liberada para o Marco nesta fase de testes. Peça ao Wagner para incluir o seu e-mail." : "Entre na sua conta para conversar com o Marco." });
    if (rota === "consumo" && req.method === "GET") return json(200, await consumo.ler());

    if (rota === "rota" && req.method === "POST") {
      try { const b = await lerCorpo(); return json(200, await calcularRota(b.pontos, b.modo, chaves())); } catch { return json(400, { erro: "Pedido inválido." }); }
    }
    // voz do Marco: ElevenLabs, voz "Eric", modelo Eleven v4 turbo (escolha de Wagner na validação 2, 30/09/2026).
    // Devolve o áudio em MP3; no consumo, "entrada" guarda os caracteres falados (a ElevenLabs cobra por caractere).
    if (rota === "voz" && req.method === "POST") {
      if (!env("ELEVENLABS_API_KEY")) return json(503, { erro: "A voz do Marco ainda não está configurada." });
      let texto; try { texto = String((await lerCorpo()).texto || "").trim().slice(0, 2500); } catch { return json(400, { erro: "Pedido inválido." }); }
      if (!texto) return json(400, { erro: "Pedido inválido." });
      const r = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${VOZ_MARCO.id}/stream?output_format=mp3_44100_128`, {
        // configuração aprovada (Eric, Turbo, MP3 128 kbps), SEM idioma fixo: o idioma fixo "pt" trouxe sotaque de
        // Portugal (Wagner, 02/10/2026). O sotaque espanhol vinha de falas curtas que também são espanhol ("Fechado,
        // seguimos!", medido pelo Scribe): o Marco não usa mais essas falas, e fala curta leva uma frase brasileira de
        // contexto (previous_text, não é falada)
        method: "POST", headers: { "xi-api-key": env("ELEVENLABS_API_KEY"), "Content-Type": "application/json", Accept: "audio/mpeg" },
        body: JSON.stringify({ text: texto, model_id: VOZ_MARCO.modelo, ...(texto.split(/\s+/).length < 8 ? { previous_text: ANCORA_BR } : {}) }),
      }).catch(() => null);
      if (!r || !r.ok) { console.error("voz:", r ? r.status + " " + (await r.text()).slice(0, 200) : "sem conexão"); return json(502, { erro: "A voz do Marco não respondeu agora." }); }
      await consumo.registrar("voz", { entrada: texto.length, saida: 0, cacheLido: 0, cacheEscrito: 0, buscas: 0, chamadas: 1, usd: 0 }, quem);
      return new Response(r.body, { status: 200, headers: { ...cors, "Content-Type": "audio/mpeg", "Cache-Control": "no-store" } });
    }
    // escuta do Marco: o app grava a fala (microfone aberto uma vez só, fecha após 2,5 s de silêncio) e manda o áudio;
    // a transcrição é a ElevenLabs Scribe (validação 2b, 30/09/2026: 97% dos termos-chave). No consumo, "entrada" = segundos.
    if (rota === "ouvir" && req.method === "POST") {
      if (!env("ELEVENLABS_API_KEY")) return json(503, { erro: "A escuta do Marco ainda não está configurada." });
      const audio = await req.arrayBuffer().catch(() => null);
      if (!audio || !audio.byteLength || audio.byteLength > LIMITE_CORPO) return json(400, { erro: "Áudio inválido." });
      const tipo = (req.headers.get("content-type") || "audio/webm").split(";")[0];
      const fd = new FormData();
      fd.append("model_id", "scribe_v1"); fd.append("language_code", "por"); fd.append("tag_audio_events", "false");
      fd.append("file", new Blob([audio], { type: tipo }), "fala." + (tipo.includes("mp4") ? "m4a" : tipo.includes("ogg") ? "ogg" : "webm"));
      const r = await fetch("https://api.elevenlabs.io/v1/speech-to-text", { method: "POST", headers: { "xi-api-key": env("ELEVENLABS_API_KEY") }, body: fd }).catch(() => null);
      if (!r || !r.ok) { console.error("ouvir:", r ? r.status + " " + (await r.text()).slice(0, 200) : "sem conexão"); return json(502, { erro: "Não consegui entender o áudio agora." }); }
      const j = await r.json().catch(() => ({}));
      const seg = Math.round((+req.headers.get("x-duracao-ms") || 0) / 1000);
      await consumo.registrar("escuta", { entrada: seg, saida: 0, cacheLido: 0, cacheEscrito: 0, buscas: 0, chamadas: 1, usd: 0 }, quem);
      return json(200, { texto: String(j.text || "").trim() });
    }
    // foto de um lugar sugerido (painel visual da tela do Marco): imagem principal do artigo da Wikipédia
    // (licença livre; o app mostra o crédito). Português primeiro, inglês se não houver. Guardada em memória.
    if (rota === "foto" && req.method === "POST") {
      let b; try { b = await lerCorpo(); } catch { return json(400, { erro: "Pedido inválido." }); }
      const nome = String(b.nome || "").trim().slice(0, 120), onde = String(b.onde || "").trim().slice(0, 80);
      if (!nome) return json(400, { erro: "Pedido inválido." });
      const chave = (nome + "|" + onde).toLowerCase();
      if (cacheFotos.has(chave)) return json(200, cacheFotos.get(chave));
      // só foto de verdade (JPG) do próprio lugar: nada de logotipo, mapa ou desenho, e o título do artigo tem de
      // conter uma palavra marcante do nome (evita "Magic Kingdom" virar o time "Orlando Magic")
      const tirarAcento = (t) => t.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
      const marcantes = tirarAcento(nome).split(/[^a-z0-9]+/).filter((w) => w.length > 3 && !["park", "parque", "beach", "praia", "center", "centro", "museum", "museu", "lake", "lago", "international", "internacional", "national", "nacional", "state", "estadual", "passeio", "tour"].includes(w));
      const confere = (titulo) => !marcantes.length || marcantes.filter((w) => tirarAcento(titulo).includes(w)).length >= Math.min(2, marcantes.length);
      const fotoBoa = (src) => /\.jpe?g($|\?|\/)/i.test(src) && !/logo|wordmark|map|mapa|location|locator|flag|bandeira|seal|coat_of_arms|icon/i.test(src);
      let r = { url: null };
      busca: for (const [lang, q] of [["en", nome], ["pt", nome], ["en", onde ? `${nome} ${onde}` : ""], ["pt", onde ? `${nome} ${onde}` : ""]]) {
        if (!q) continue;
        try {
          const u = `https://${lang}.wikipedia.org/w/api.php?action=query&format=json&generator=search&gsrlimit=4&gsrsearch=${encodeURIComponent(q)}&prop=pageimages|info&inprop=url&piprop=thumbnail&pithumbsize=720&pilicense=free&origin=*`;
          const j = await (await fetch(u, { headers: { "User-Agent": "Cle-app/1.0 (https://cle-travel.github.io/cle-app/)" } })).json();
          const paginas = Object.values((j && j.query && j.query.pages) || {}).sort((a, b) => a.index - b.index);
          for (const p of paginas) if (p.thumbnail && fotoBoa(p.thumbnail.source) && confere(p.title)) { r = { url: p.thumbnail.source, titulo: p.title, pagina: p.fullurl, fonte: "Wikipédia" }; break busca; }
        } catch {}
      }
      if (cacheFotos.size > 2000) cacheFotos.clear();
      cacheFotos.set(chave, r);
      return json(200, r);
    }
    if (rota === "lugar" && req.method === "POST") {
      try { const b = await lerCorpo(); if (!b.consulta) throw 0; return json(200, await buscarLugar(String(b.consulta), b.perto || null, chaves(), { pais: b.pais, forma: b.forma })); } catch { return json(400, { erro: "Pedido inválido." }); }
    }
    if ((rota === "ficha" || rota === "resumir") && req.method === "POST") {
      let b; try { b = await lerCorpo(); } catch { return json(400, { erro: "Pedido inválido." }); }
      const c = await prontoParaClaude(); if (c.erro) return c.erro;
      try {
        const r = rota === "ficha" ? await fichaOnboarding({ client: c.client, fala: String(b.fala || "").slice(-6000), hoje: String(b.hoje || "").slice(0, 20), quem: String(b.quem || "").slice(0, 60), ficha: b.ficha, perfil: b.perfil, memoria: String(b.memoria || "").slice(0, 3000), etapa: +b.etapa || 0, ultima: String(b.ultima || "").slice(0, 1500) }) : await resumirConversa({ client: c.client, texto: String(b.texto || "") });
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
