// Testes automáticos do Clé: rodam antes de cada commit (.githooks/pre-commit) e bloqueiam a publicação se falharem.
// Nasceram de defeitos reais (trava automática, não promessa):
//  - 01/10/2026: o token da conta não era lido ("Bearers+" no lugar de "Bearer\s+") e o Marco recusava contas liberadas;
//  - 01/10/2026: no Android, o ditado repetia a frase inteira a cada atualização.
// Rodar à mão:  node prototipo/testar.mjs

import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath, pathToFileURL } from "node:url";

const RAIZ = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
let falhas = 0, total = 0;
const confere = (nome, obtido, esperado) => {
  total++;
  const ok = JSON.stringify(obtido) === JSON.stringify(esperado);
  if (!ok) { falhas++; console.error(`  FALHOU: ${nome}\n    esperado: ${JSON.stringify(esperado)}\n    obtido:   ${JSON.stringify(obtido)}`); }
};

// ---------- 1. servidor: leitura do token e acesso por conta / código ----------
const { criarApi, tokenDoCabecalho } = await import(pathToFileURL(path.join(RAIZ, "servidor-marco", "http.mjs")).href);
confere("token: Bearer + espaço", tokenDoCabecalho("Bearer abc.def"), "abc.def");
confere("token: minúsculas e espaços extras", tokenDoCabecalho("bearer   abc"), "abc");
confere("token: vazio", tokenDoCabecalho(""), "");

const fetchReal = globalThis.fetch;
globalThis.fetch = async (url, opc = {}) => {
  if (String(url).endsWith("/auth/v1/user")) {
    const auth = (opc.headers || {}).Authorization || "";
    if (auth === "Bearer tok-liberado") return new Response(JSON.stringify({ email: "Liberado@Exemplo.com" }), { status: 200 });
    if (auth === "Bearer tok-outro") return new Response(JSON.stringify({ email: "outra@exemplo.com" }), { status: 200 });
    return new Response(JSON.stringify({ msg: "invalid JWT" }), { status: 401 });
  }
  return fetchReal(url, opc);
};
const ENV = { SUPABASE_URL: "https://teste.supabase.co", SUPABASE_SERVICE_ROLE_KEY: "chave-teste", PERMITIDOS: JSON.stringify({ Teste: "liberado@exemplo.com" }), TESTADORES: JSON.stringify({ Codigo: "CLE-TEST-TEST-TEST" }), ANTHROPIC_API_KEY: "x" };
const tratar = criarApi({ env: (k) => ENV[k], Anthropic: class {}, consumo: { registrar: async () => {}, ler: async () => ({ hoje: { usd: 0 } }) }, exigirAcesso: true, origens: ["https://cle-travel.github.io"] });
const estado = async (headers) => (await tratar(new Request("https://x.supabase.co/functions/v1/api/estado", { headers }))).json();
let e = await estado({ Authorization: "Bearer tok-liberado" });
confere("conta liberada (e-mail com maiúsculas) → acesso", [e.acesso, e.quem], [true, "Teste"]);
e = await estado({ Authorization: "Bearer tok-outro" });
confere("conta fora da lista → não liberada", [e.acesso, e.motivo], [false, "conta_nao_liberada"]);
e = await estado({ Authorization: "Bearer tok-invalido" });
confere("token inválido → conta inválida", [e.acesso, e.motivo], [false, "conta_invalida"]);
e = await estado({ "x-cle-acesso": "CLE-TEST-TEST-TEST", Authorization: "Bearer tok-invalido" });
confere("código de acesso continua valendo", [e.acesso, e.quem], [true, "Codigo"]);
e = await estado({});
confere("sem conta e sem código → bloqueado", e.acesso, false);
globalThis.fetch = fetchReal;

// ---------- 2. app: ditado sem repetição (função juntarFala extraída do app) ----------
const app = fs.readFileSync(path.join(RAIZ, "prototipo", "app.html"), "utf8");
const trecho = app.slice(app.indexOf("// /*juntarFala:inicio*/"), app.indexOf("// /*juntarFala:fim*/"));
if (!trecho.includes("function juntarFala")) { falhas++; console.error("  FALHOU: função juntarFala não encontrada no app"); }
else {
  const ctx = {}; vm.runInNewContext(trecho + "\nthis.juntarFala = juntarFala;", ctx);
  const j = ctx.juntarFala;
  confere("Android (frase acumulada)", j(["Oi", "Oi Marco", "Oi Marco tudo", "Oi Marco tudo bem", "Oi Marco tudo bem eu quero"]), "Oi Marco tudo bem eu quero");
  confere("Android com correção de maiúscula", j(["oi marco", "Oi Marco, tudo bem?"]), "Oi Marco, tudo bem?");
  confere("computador (trechos novos)", j(["Quero ir para o Japão", "em abril com o Arthur"]), "Quero ir para o Japão em abril com o Arthur");
  confere("trecho repetido igual", j(["Oi Marco", "Oi Marco"]), "Oi Marco");
  confere("vazios ignorados", j(["", "  ", "Oi"]), "Oi");
}

// ---------- 3. app montado: sintaxe do código e largura de tela ----------
const idx = path.join(RAIZ, "app", "index.html");
if (fs.existsSync(idx)) {
  const h = fs.readFileSync(idx, "utf8"), i = h.indexOf("<script>") + 8, f = h.indexOf("</script", i);
  try { new vm.Script(h.slice(i, f)); total++; } catch (err) { falhas++; console.error("  FALHOU: sintaxe do app montado:", err.message); }
  confere("app tem meta viewport", /<meta name="viewport" content="width=device-width/.test(h), true);
}

// ---------- 4. voz do Marco: só a voz aprovada (ElevenLabs "Eric", Eleven v4 turbo; Wagner, 30/09/2026) ----------
// Em 01/10 a voz do aparelho (robótica) entrou no lugar sem aviso; esta trava impede que se repita.
const http = fs.readFileSync(path.join(RAIZ, "servidor-marco", "http.mjs"), "utf8");
confere("voz do Marco é a Eric (cjVigY5qzO86Huf0OWal)", /VOZ_MARCO = \{ id: "cjVigY5qzO86Huf0OWal", nome: "Eric", modelo: "eleven_v4_turbo" \}/.test(http), true);
const falaMarco = app.slice(app.indexOf("async function marcoFalar"), app.indexOf("function marcoCalar"));
confere("marcoFalar não usa a voz do aparelho", falaMarco.length > 0 && !/speechSynthesis|SpeechSynthesisUtterance/.test(falaMarco), true);
confere("marcoFalar usa a rota /voz do servidor", /apiFetch\("\/voz"/.test(app), true);

// ---------- 5. legendas do Marco (modo CC): blocos curtos, sem perder nem repetir palavras ----------
const trechoLeg = app.slice(app.indexOf("function blocosLegenda"), app.indexOf("function legendar"));
const blocosLegenda = new Function(trechoLeg + "; return blocosLegenda;")();
const fraseLonga = "Olá, Wagner! Que bom ter você no Clé. Eu sou o Marco, seu concierge de viagens, e vou cuidar do planejamento junto com você: do roteiro de cada dia às reservas, gastos e imprevistos. Me conta: pra onde vocês querem ir, quando e quem vai?";
const bl = blocosLegenda(fraseLonga);
confere("legenda: nenhum bloco passa de 80 letras", bl.every((b) => b.length <= 80), true);
confere("legenda: o texto inteiro aparece, na ordem", bl.join(" "), fraseLonga);
const linhaOnb = (app.match(/\n  onb\(\) \{[^\n]*/) || [""])[0];
confere("abertura da Nova viagem não fala sozinha", /S\.onb\.intro = true; ir\("onboarding"\); \},?\r?$/.test(linhaOnb) && !/marcoFalar/.test(linhaOnb), true);
// ---------- 6. conversa por voz e rascunho (01/10/2026) ----------
confere("tela fica acesa durante a conversa por voz", /navigator\.wakeLock\.request\("screen"\)/.test(app), true);
confere("rascunho da Nova viagem é salvo a cada toque", /function memSalvar\(\) \{\n  rascunhoSalvar\(\);/.test(app), true);
confere("começar do zero apaga o rascunho antigo", /\n  onb\(\) \{[^\n]*rascunhoApagar\(\)/.test(app), true);
// ---------- 7. botão do Marco sempre disponível e dentro da tela (01/10/2026) ----------
confere("botão do Marco em todas as etapas da Nova viagem", app.includes('${!o.intro || (marcoDisponivel() && S.vozOn) ? `<div class="doca">') && !/o\.step === 0 && \(!o\.intro/.test(app), true);
confere("botão do Marco flutuante nas telas da viagem", /const marcoFlutua = S\.viagem && tabbar/.test(app), true);
confere("altura do app medida pela área visível", /setProperty\("--altura-app"/.test(app) && /height:var\(--altura-app,100dvh\)/.test(app), true);
// ---------- 8. conversa contínua: só o Marco diz quando a tela terminou (bug de 01/10/2026) ----------
const nucleo = fs.readFileSync(path.join(RAIZ, "servidor-marco", "nucleo.mjs"), "utf8");
confere("app não decide o fim da conversa pela pontuação da fala", !/\/\\\?\\s\*\$\/\.test\(o\.marco\)/.test(app), true);
confere("Marco avisa quando a tela terminou (avancar)", /avancar: \{ type: "boolean"/.test(nucleo) && /j\.avancar && o\.porVoz/.test(app), true);
confere("depois de cada fala o Marco volta a ouvir", /function continuarOuvindo\(o\)/.test(app), true);
confere("interesses em carrossel de cartões", /class="carrossel" id="carInt"/.test(app), true);
// ---------- 9. situações (cenários): critérios de qualidade de 02/10/2026 ----------
const iniC = app.indexOf("const CENARIOS = ["), fimC = app.indexOf("\n];", iniC) + 3;
const CEN = new Function(app.slice(iniC, fimC) + "; return CENARIOS;")();
const EIXOS = ["aventura", "explorar", "fora", "premium"], palavras = (t) => t.trim().split(/\s+/).length;
confere("situações: ids únicos", new Set(CEN.map((s) => s.id)).size === CEN.length, true);
confere("situações: pergunta de até 14 palavras", CEN.filter((s) => palavras(s.p) > 14).map((s) => s.id), []);
confere("situações: 4 opções de até 8 palavras", CEN.filter((s) => s.o.length !== 4 || s.o.some(([t]) => palavras(t) > 8)).map((s) => s.id), []);
confere("situações: toda opção mexe em um eixo válido do perfil", CEN.filter((s) => s.o.some(([, e]) => !Object.keys(e).length || Object.keys(e).some((k) => !EIXOS.includes(k)))).map((s) => s.id), []);
confere("situações: texto interno não aparece na tela", app.includes("Cenários ajustam o perfil"), false);
confere("tela do Marco por voz (sem caixa de texto do Marco)", /function telaConversaEscrita\(/.test(app) && /falarRespostaMarco\(m\)/.test(app), true);
// ---------- 10. regras de 02/10/2026 (tarde) ----------
confere("conversa escrita só com o Marco mudo (CC)", /if \(S\.legendas\) return telaConversaEscrita\(\);/.test(app), true);
confere("histórico de conversas em Mais", /it\("conversas", "chat", "Histórico de conversas"/.test(app), true);
confere("painel visual do planejamento na tela do Marco", /function painelPlanejamento\(\)/.test(app), true);
confere("servidor interrompe passo longo antes do limite da nuvem", /codigo: "tempo"/.test(nucleo) && /prazoMs \+ 25000/.test(nucleo), true);
confere("planejamento em lotes de até 3 dias", /no máximo 3 dias por resposta/.test(nucleo), true);
confere("app refaz em partes quando o servidor avisa tarefa grande", /codigo === "tempo" && modo === "planejamento"/.test(app), true);
confere("erro de conexão em português, não \"network error\"", /A conexão com o Marco caiu no meio da resposta/.test(app), true);
confere("silêncio: pausa por tempo sem fala nem toque, não por tentativas", /const SILENCIO_MAX = 120000/.test(app) && !/\+\+silencios > 6/.test(app), true);
// ---------- 11. regras de 02/10/2026 (noite) ----------
confere("voz na configuração aprovada (sem idioma fixo: pt trouxe sotaque de Portugal)", !/model_id: VOZ_MARCO\.modelo, language_code/.test(http) && /previous_text: ANCORA_BR/.test(http), true);
// Wagner, 02/10/2026: a escuta por gravação (Scribe) ficou lenta no celular; volta o ditado do celular (método original)
confere("escuta pelo ditado do celular (gravação + Scribe desligada)", /const ESCUTA_SCRIBE = false;/.test(app), true);
confere("frase de contexto só nas falas curtas (contagem de palavras certa)", http.includes("texto.split(/\\s+/).length < 8"), true);
confere("Marco não usa falas curtas que soam espanhol", !nucleo.includes('ex.: "Fechado, seguimos!"') && nucleo.includes('nunca "Fechado, seguimos!"'), true);
confere("falar não descarta cartões sem decisão", !/k\.estado = "ignorado"/.test(app) && /k\.pendenteEnviado = true/.test(app), true);
confere("Marco decide cartões pela voz (decidir_cartoes)", /decidir_cartoes: \{/.test(nucleo) && /aplicarDecisoesFaladas\(k\)/.test(app), true);
confere("interesses são desta viagem e no singular (cada pessoa no próprio celular)", /O que você quer nesta viagem\?/.test(app) && /Nesta tela a escolha é sua/.test(app) && /interesses PARA ESTA VIAGEM/.test(nucleo), true);
confere("sem espera de 2,5 s nem reabrir o microfone: o texto vai assim que o ditado termina", !/esperarPausa\(\(\) =>/.test(app), true);
// ---------- 12. barra invertida perdida pelo terminal (erro repetido 4 vezes em 01-02/10/2026) ----------
// expressões que precisam da barra: se ela sumir, o código continua rodando mas faz outra coisa
const montar = fs.readFileSync(path.join(RAIZ, "prototipo", "montar.mjs"), "utf8");
const semBarra = [[montar, "/\\.(webp|jpe?g|png|avif)$/i", "montar: extensão das fotos"], [montar, "/\\.[^.]+$/", "montar: nome da foto"],
  [http, "texto.split(/\\s+/)", "servidor: contagem de palavras"], [app, "/\\?\\s*$/", "(nenhum, só referência)"]].filter(([src, trecho, nome]) => nome.startsWith("(") ? false : !src.includes(trecho)).map(([, , n]) => n);
confere("expressões com barra invertida intactas", semBarra, []);
// ---------- 13. telas de cartões só por toque (Wagner, 02/10/2026) ----------
confere("cartão renomeado para Natureza e ar livre (com foto)", app.includes('"Natureza e ar livre"') && fs.existsSync(path.join(RAIZ, "prototipo", "imagens", "interesses", "natureza-e-ar-livre.webp")), true);
confere("interesses e situações só por toque: o Marco explica e não abre o microfone", /const ETAPAS_SO_TOQUE = \[2, 3\];/.test(app) && /S\.vozAtiva = !soToque/.test(app), true);
confere("situações em cartões com foto", /function blocoSituacoes\(o\)/.test(app) && /__FOTOS_SITUACOES__/.test(app), true);
confere("toda opção de situação tem nome de foto na lista do LEIA-ME", (() => { const l = fs.readFileSync(path.join(RAIZ, "prototipo", "imagens", "situacoes", "LEIA-ME.md"), "utf8"); return CEN.every((s) => s.o.every((_, k) => l.includes(`${s.id}-${k + 1}.webp`))); })(), true);
// ---------- 14. fase 1 do planejamento humano: menu do Roteiro e entrevista A-E (02/10/2026) ----------
confere("menu do Roteiro com Dias e tópicos A a E", /function menuRoteiro\(\)/.test(app) && ["atividades", "hospedagem", "transporte", "alimentacao", "compras"].every((t) => app.includes(`id: "${t}", letra:`)), true);
confere("Marco anota metas (registrar_metas) com inegociável/opcional", /registrar_metas: \{/.test(nucleo) && /enum: \["inegociavel", "opcional", "a_definir"\]/.test(nucleo) && /aplicarMetas\(k\)/.test(app), true);
confere("metas vão no contexto do Marco", /Metas da viagem \(entrevista A-E\)/.test(app), true);
confere("planejador usa as metas (inegociáveis entram, opcionais saem primeiro)", /itens inegociáveis entram sempre/.test(nucleo), true);
confere("as 28 fotos das situações estão em WebP", CEN.every((s) => s.o.every((_, k) => fs.existsSync(path.join(RAIZ, "prototipo", "imagens", "situacoes", `${s.id}-${k + 1}.webp`)))), true);
confere("viagem criada apaga o rascunho", /rascunhoApagar\(\); S\.vozAtiva = false; \/\/ viagem criada/.test(app), true);

if (falhas) { console.error(`TESTES: ${falhas} de ${total} falharam. Publicação bloqueada.`); process.exit(1); }
console.log(`testes: ${total} de ${total} passaram.`);
