// Relatório diário de consumo do Marco (fase de testes):  node prototipo/relatorio-consumo.mjs [AAAA-MM-DD]
// Lê a tabela "consumo" do Supabase (nuvem) e o registro do computador de testes (servidor-marco/consumo/),
// e grava relatorios/consumo-AAAA-MM-DD.md (pasta privada, nunca publicada). Nenhum conteúdo de conversa:
// só números por pedido (modo, quem, tokens, cache, buscas, custo estimado).
// Credenciais: seguranca/supabase.json (nunca impressas).

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const RAIZ = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const CREDITOS_USD = 20; // créditos pré-pagos na Anthropic (01/10/2026), sem recarga automática
const INICIO = "2026-10-01";
// gastos reais que não passaram pelo registro (testes direto no núcleo), para o saldo bater com o console
const FORA_DO_REGISTRO = [{ dia: "2026-10-01", usd: 0.0889, nota: "2 turnos de teste do Marco direto no núcleo (terminal)" }];
const dia = process.argv[2] || new Date(Date.now() - 3 * 3600e3).toISOString().slice(0, 10); // dia de Brasília
const usd = (v) => "US$ " + (+v).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 4 });
const pct = (a, b) => (b ? Math.round((100 * a) / b) + "%" : "–");
const brt = (iso) => new Date(new Date(iso).getTime() - 3 * 3600e3).toISOString().slice(11, 16);

// ---------- dados ----------
const { ref, token } = JSON.parse(fs.readFileSync(path.join(RAIZ, "seguranca", "supabase.json"), "utf8"));
const r = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
  method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
  body: JSON.stringify({ query: `select quando, modo, quem, entrada, saida, cache_lido, cache_escrito, buscas, chamadas, usd from public.consumo where quando >= '${INICIO}' order by quando` }),
});
if (!r.ok) { console.error("Não foi possível ler o consumo da nuvem:", r.status, (await r.text()).slice(0, 200)); process.exit(1); }
const nuvem = (await r.json()).map((x) => ({ quando: x.quando, modo: x.modo, quem: x.quem || "?", entrada: +x.entrada, saida: +x.saida, cacheLido: +x.cache_lido, cacheEscrito: +x.cache_escrito, buscas: +x.buscas, chamadas: +x.chamadas, usd: +x.usd, onde: "nuvem" }));
const local = [];
const dirL = path.join(RAIZ, "servidor-marco", "consumo");
if (fs.existsSync(dirL)) for (const f of fs.readdirSync(dirL).filter((x) => x.endsWith(".jsonl"))) for (const l of fs.readFileSync(path.join(dirL, f), "utf8").split("\n").filter(Boolean)) { const x = JSON.parse(l); local.push({ ...x, quem: x.quem || "local", onde: "computador" }); }
const tudo = [...nuvem, ...local];
// a voz (ElevenLabs) não é Claude: fica fora das contas do Claude e ganha uma seção própria
const todos = tudo.filter((x) => x.modo !== "voz" && x.modo !== "escuta"), vozes = tudo.filter((x) => x.modo === "voz"), escutas = tudo.filter((x) => x.modo === "escuta");
const noDia = (x) => new Date(new Date(x.quando).getTime() - 3 * 3600e3).toISOString().slice(0, 10) === dia;
const doDia = todos.filter(noDia), vozDia = vozes.filter(noDia);

const soma = (ls) => ls.reduce((a, x) => ({ n: a.n + 1, usd: a.usd + x.usd, entrada: a.entrada + x.entrada, saida: a.saida + x.saida, lido: a.lido + x.cacheLido, escrito: a.escrito + x.cacheEscrito, buscas: a.buscas + x.buscas, chamadas: a.chamadas + x.chamadas }), { n: 0, usd: 0, entrada: 0, saida: 0, lido: 0, escrito: 0, buscas: 0, chamadas: 0 });
const grupo = (ls, k) => Object.entries(ls.reduce((a, x) => ((a[x[k]] = a[x[k]] || []).push(x), a), {})).map(([nome, l]) => ({ nome, ...soma(l) })).sort((a, b) => b.usd - a.usd);
const D = soma(doDia), T = soma(todos);
const cacheTaxa = (s) => pct(s.lido, s.entrada + s.lido + s.escrito);

// ---------- alertas (o que merece atenção) ----------
const alertas = [];
const diasDeUso = new Set(todos.map((x) => x.quando.slice(0, 10))).size || 1;
const fora = FORA_DO_REGISTRO.reduce((a, x) => a + x.usd, 0);
const mediaDia = (T.usd + fora) / diasDeUso, saldo = CREDITOS_USD - T.usd - fora;
if (saldo < 5) alertas.push(`Saldo estimado baixo: ${usd(saldo)} dos ${usd(CREDITOS_USD)}. Recarregue no console antes de acabar.`);
if (mediaDia > 0) alertas.push(`No ritmo atual (${usd(mediaDia)}/dia de uso), os créditos durariam cerca de ${Math.max(0, Math.floor(saldo / mediaDia))} dia(s) de uso.`);
for (const g of grupo(doDia, "modo")) {
  const taxa = (g.lido) / Math.max(1, g.entrada + g.lido + g.escrito);
  // só conversas com histórico usam cache; voz, ficha, resumo e comprovante são pedidos avulsos
  if (["conversa", "planejamento"].includes(g.nome) && g.n >= 3 && taxa < 0.5) alertas.push(`Cache baixo em "${g.nome}" (${Math.round(taxa * 100)}%): o histórico pode estar sendo reenviado sem aproveitar o cache. Investigar.`);
}
const caros = [...doDia].sort((a, b) => b.usd - a.usd).slice(0, 5);
for (const x of caros) if (x.usd > 0.5) alertas.push(`Pedido caro: ${usd(x.usd)} em "${x.modo}" às ${brt(x.quando)} (${x.chamadas} chamadas, ${x.entrada + x.cacheLido + x.cacheEscrito} tokens de entrada).`);
const plan = doDia.filter((x) => x.modo === "planejamento"), conv = doDia.filter((x) => x.modo === "conversa");
if (plan.length && conv.length && soma(plan).usd / plan.length > 8 * (soma(conv).usd / conv.length)) alertas.push("O planejamento (Opus) está custando mais de 8 vezes a conversa (Sonnet) por pedido; conferir se pedidos simples estão indo para o planejamento.");

// ---------- voz do Marco (ElevenLabs): saldo da conta + caracteres falados pelo app ----------
// A chave fica em servidor-marco/.env (nunca impressa) e precisa da permissão "Usuário". Uma foto do saldo por dia
// fica em relatorios/elevenlabs-saldo.json para medir o ritmo de gasto e estimar quantos dias o crédito aguenta.
const chaveEleven = (() => { try { return (fs.readFileSync(path.join(RAIZ, "servidor-marco", ".env"), "utf8").match(/^ELEVENLABS_API_KEY=(.+)$/m) || [])[1]?.trim(); } catch { return null; } })();
let eleven = null, elevenErro = null;
if (chaveEleven) {
  try {
    const re = await fetch("https://api.elevenlabs.io/v1/user/subscription", { headers: { "xi-api-key": chaveEleven } });
    const j = await re.json();
    if (re.ok) eleven = { plano: j.tier, usados: +j.character_count, limite: +j.character_limit, renova: new Date(j.next_character_count_reset_unix * 1000) };
    else elevenErro = j?.detail?.status === "missing_permissions" ? "a chave não tem a permissão \"Usuário\"" : `erro ${re.status}`;
  } catch (e) { elevenErro = "sem conexão com a ElevenLabs"; }
} else elevenErro = "chave não encontrada em servidor-marco/.env";
const arqFotos = path.join(RAIZ, "relatorios", "elevenlabs-saldo.json");
let fotos = {}; try { fotos = JSON.parse(fs.readFileSync(arqFotos, "utf8")); } catch {}
const nInt = (v) => Math.round(v).toLocaleString("pt-BR");
const V = vozDia.reduce((a, x) => ({ n: a.n + 1, car: a.car + x.entrada }), { n: 0, car: 0 });
const VT = vozes.reduce((a, x) => ({ n: a.n + 1, car: a.car + x.entrada }), { n: 0, car: 0 });
const minutosEscuta = (ls) => { const s = ls.reduce((a, x) => a + (+x.entrada || 0), 0); return `${ls.length} trecho(s), ${Math.floor(s / 60)} min ${s % 60} s`; };
let mdVoz = `## Voz do Marco (ElevenLabs)\n\n| | Dia | Desde ${INICIO.split("-").reverse().join("/")} |\n|---|---|---|\n| Falas geradas | ${V.n} | ${VT.n} |\n| Caracteres falados | ${nInt(V.car)} | ${nInt(VT.car)} |\n| Fala ouvida (Scribe) | ${minutosEscuta(escutas.filter(noDia))} | ${minutosEscuta(escutas)} |\n`;
if (eleven) {
  fotos[dia] = { usados: eleven.usados, limite: eleven.limite, renova: eleven.renova.toISOString().slice(0, 10) };
  fs.mkdirSync(path.dirname(arqFotos), { recursive: true }); fs.writeFileSync(arqFotos, JSON.stringify(fotos, null, 1));
  const restante = eleven.limite - eleven.usados;
  // ritmo: créditos gastos por dia desde a primeira foto do ciclo atual (mesma data de renovação)
  const ciclo = Object.entries(fotos).filter(([, f]) => f.renova === fotos[dia].renova).sort(([a], [b]) => a.localeCompare(b));
  const [d0, f0] = ciclo[0], dias = Math.max(1, Math.round((new Date(dia) - new Date(d0)) / 864e5));
  const porDia = ciclo.length > 1 ? (eleven.usados - f0.usados) / dias : eleven.usados;
  const ateRenovar = Math.max(0, Math.ceil((eleven.renova - Date.now()) / 864e5));
  mdVoz += `| Créditos usados no ciclo | | ${nInt(eleven.usados)} de ${nInt(eleven.limite)} (${pct(eleven.usados, eleven.limite)}) |\n| Créditos restantes | | ${nInt(restante)} |\n| Renovação | | ${eleven.renova.toLocaleDateString("pt-BR")} (em ${ateRenovar} dia(s)), plano ${eleven.plano} |\n\n`;
  if (porDia > 0) {
    const duram = Math.floor(restante / porDia);
    mdVoz += `No ritmo atual (${nInt(porDia)} créditos/dia), o saldo dura cerca de **${duram} dia(s)**${duram >= ateRenovar ? ", ou seja, chega até a renovação." : `: acaba antes da renovação (faltariam ${ateRenovar - duram} dia(s)).`}\n`;
    if (restante < 0.15 * eleven.limite) alertas.push(`Voz: restam só ${nInt(restante)} créditos da ElevenLabs (${pct(restante, eleven.limite)}). Quando acabar, o Marco passa a escrever em legendas.`);
    if (duram < ateRenovar) alertas.push(`Voz: no ritmo atual os créditos da ElevenLabs acabam em ~${duram} dia(s), antes da renovação de ${eleven.renova.toLocaleDateString("pt-BR")}.`);
  } else mdVoz += VT.car > 0 ? `O contador da ElevenLabs ainda não descontou a fala do app (a promoção "Eleven v4 grátis por 2 semanas" pode estar cobrindo o v4 turbo). O ritmo aparece quando o saldo começar a cair.\n` : "Sem uso de voz ainda neste ciclo.\n";
} else { mdVoz += `\nSaldo da ElevenLabs indisponível: ${elevenErro}.\n`; alertas.push(`Voz: não consegui ler o saldo da ElevenLabs (${elevenErro}).`); }

// ---------- relatório ----------
const linhaG = (g) => `| ${g.nome} | ${g.n} | ${g.chamadas} | ${usd(g.usd)} | ${usd(g.usd / g.n)} | ${cacheTaxa({ entrada: g.entrada, lido: g.lido, escrito: g.escrito })} | ${g.buscas} |`;
const cab = "| | Pedidos | Chamadas | Custo | Por pedido | Cache | Buscas web |\n|---|---|---|---|---|---|---|";
let md = `# Consumo do Marco: ${dia.split("-").reverse().join("/")}\n\nGerado em ${new Date().toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" })} a partir do banco na nuvem e do computador de testes. Valores estimados pela tabela de preços (conferir o gasto real em console.anthropic.com).\n\n`;
md += `## Resumo\n\n| | Dia | Desde ${INICIO.split("-").reverse().join("/")} |\n|---|---|---|\n| Custo | ${usd(D.usd)} | ${usd(T.usd)} |\n| Pedidos | ${D.n} | ${T.n} |\n| Chamadas ao Claude | ${D.chamadas} | ${T.chamadas} |\n| Custo médio por pedido | ${D.n ? usd(D.usd / D.n) : "–"} | ${T.n ? usd(T.usd / T.n) : "–"} |\n| Entrada vinda do cache | ${cacheTaxa(D)} | ${cacheTaxa(T)} |\n| Buscas na web | ${D.buscas} | ${T.buscas} |\n| Saldo estimado dos créditos | | ${usd(saldo)} de ${usd(CREDITOS_USD)} |\n\n`;
md += `## Por modo (dia)\n\n${cab}\n${grupo(doDia, "modo").map(linhaG).join("\n") || "| (sem uso) | | | | | | |"}\n\n`;
md += `## Por pessoa (dia)\n\n${cab}\n${grupo(doDia, "quem").map(linhaG).join("\n") || "| (sem uso) | | | | | | |"}\n\n`;
md += `## Pedidos mais caros do dia\n\n| Hora | Modo | Quem | Chamadas | Entrada (nova / cache / gravada) | Saída | Custo |\n|---|---|---|---|---|---|---|\n${caros.map((x) => `| ${brt(x.quando)} | ${x.modo} | ${x.quem} | ${x.chamadas} | ${x.entrada} / ${x.cacheLido} / ${x.cacheEscrito} | ${x.saida} | ${usd(x.usd)} |`).join("\n") || "| – | | | | | | |"}\n\n`;
md += mdVoz + "\n";
md += `## Alertas\n\n${alertas.length ? alertas.map((a) => "- " + a).join("\n") : "- Nada fora do esperado."}\n`;

const dirR = path.join(RAIZ, "relatorios");
fs.mkdirSync(dirR, { recursive: true });
const arq = path.join(dirR, `consumo-${dia}.md`);
fs.writeFileSync(arq, md);
console.log(md);
console.log(`\n(gravado em ${arq})`);
