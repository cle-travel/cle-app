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

if (falhas) { console.error(`TESTES: ${falhas} de ${total} falharam. Publicação bloqueada.`); process.exit(1); }
console.log(`testes: ${total} de ${total} passaram.`);
