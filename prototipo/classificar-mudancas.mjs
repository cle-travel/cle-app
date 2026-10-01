// Comparação de funcionalidades entre a versão corrente (main) e uma proposta de colaborador.
// Regra de Wagner (01/10/2026): o Arthur atua só no DESIGN; qualquer mudança de lógica, segurança ou funcionamento
// (inclusive voltar a uma versão antiga) só entra com aprovação prévia de Wagner.
//
//   node prototipo/classificar-mudancas.mjs <pasta da versão corrente> <pasta da proposta> [relatorio.md]
//   saída 0 = só design (pode entrar)   ·   saída 2 = precisa de análise (não substituir)
//
// Como decide:
//  - Estilos (<style>), imagens e documentação (.md) são design.
//  - No código do app, o comparador lê os dois programas e mascara o que é aparência (marcação HTML dos
//    templates, classes, estilos embutidos e textos das telas). Se o que sobra (a lógica) for igual, é design.
//    Se mudar qualquer função, condição, chamada, nome, número ou texto técnico, é funcionalidade.
//  - Servidor, nuvem, rotinas de publicação, segurança e configurações: sempre funcionalidade.
//  - app/ (gerado) precisa ser exatamente a montagem do código-fonte da proposta.
//  - Mudança no app exige subir a versão (prototipo/versao.json) e nunca rebaixar.
// Usa o leitor de JavaScript "acorn" (instalado só na rotina do GitHub; caminho em ACORN_DIR).

import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";
import { createRequire } from "node:module";

const [, , BASE, PROP, SAIDA] = process.argv;
if (!BASE || !PROP) { console.error("uso: node classificar-mudancas.mjs <corrente> <proposta> [relatorio.md]"); process.exit(1); }
const req = createRequire(path.join(process.env.ACORN_DIR || process.cwd(), "x.js"));
const acorn = req("acorn");

const ler = (raiz, f) => (fs.existsSync(path.join(raiz, f)) ? fs.readFileSync(path.join(raiz, f), "utf8") : null);
const listar = (raiz) => execSync("git ls-files", { cwd: raiz, encoding: "utf8" }).split("\n").filter(Boolean);
const arquivos = [...new Set([...listar(BASE), ...listar(PROP)])].filter((f) => ler(BASE, f) !== ler(PROP, f));

const DESIGN_ARQ = /\.(png|jpe?g|webp|gif|svg|ico|woff2?|ttf|otf)$/i;
const DOC_ARQ = /\.md$/i;
const COM_CODIGO = ["prototipo/app.html", "prototipo/carteira/index.html"];

const design = [], funcional = [], avisos = [];

// ---------- leitura do código: o que é aparência fica mascarado ----------
const ehTextoDeTela = (s) => /[A-Za-zÀ-ú]{2,}[\s,.:;!?]+[A-Za-zÀ-ú]{2,}/.test(s) && !/^(https?:|\/|\.\/)/.test(s);
const ehMarcacao = (s) => /<[a-z!\/]|style=|class=|^[\s\w#.,:;%()'"-]*:[^;]+;/.test(s);
function sinais(codigo) {
  const out = [];
  for (const t of acorn.tokenizer(codigo, { ecmaVersion: "latest", allowHashBang: true, allowReturnOutsideFunction: true })) {
    const l = t.type.label;
    if (l === "template") out.push({ v: "§TPL", ini: t.start });
    else if (l === "string") out.push({ v: ehMarcacao(t.value) || ehTextoDeTela(t.value) ? "§TXT" : JSON.stringify(t.value), ini: t.start });
    else out.push({ v: t.value === undefined || t.value === null ? l : `${l}:${typeof t.value === "object" ? String(t.value.pattern || t.value) : t.value}`, ini: t.start });
  }
  return out;
}
// funções nomeadas (declaradas, constantes e métodos do mapa de ações A) com a assinatura da lógica
function funcoes(codigo) {
  const mapa = new Map();
  let ast; try { ast = acorn.parse(codigo, { ecmaVersion: "latest", allowReturnOutsideFunction: true }); } catch { return mapa; }
  const sinalDe = (n) => sinais(codigo.slice(n.start, n.end)).map((x) => x.v).join(" ");
  const texto = (n) => codigo.slice(n.start, n.end);
  for (const no of ast.body) {
    if (no.type === "FunctionDeclaration" && no.id) mapa.set(no.id.name, { logica: sinalDe(no), texto: texto(no) });
    if (no.type === "VariableDeclaration") for (const d of no.declarations) {
      if (!d.id || !d.id.name || !d.init) continue;
      if (/Function|Arrow/.test(d.init.type)) mapa.set(d.id.name, { logica: sinalDe(d.init), texto: texto(d.init) });
      else if (d.init.type === "ObjectExpression" && d.id.name === "A") for (const p of d.init.properties) { if (p.key) mapa.set("A." + (p.key.name || p.key.value), { logica: sinalDe(p), texto: texto(p) }); }
      else mapa.set(d.id.name, { logica: sinalDe(d.init), texto: texto(d.init) });
    }
  }
  return mapa;
}
const blocos = (html, tag) => [...html.matchAll(new RegExp(`<${tag}(\\s[^>]*)?>([\\s\\S]*?)</${tag}>`, "gi"))].filter((m) => !/\ssrc=/.test(m[1] || "")).map((m) => m[2]);
const semBlocos = (html) => html.replace(/<script[\s\S]*?<\/script>/gi, "§SCRIPT").replace(/<style[\s\S]*?<\/style>/gi, "§STYLE");

function compararArquivoComCodigo(f) {
  const a = ler(BASE, f) || "", b = ler(PROP, f) || "";
  if (blocos(a, "style").join("\n") !== blocos(b, "style").join("\n")) design.push(`${f}: estilos (CSS)`);
  const fa = semBlocos(a), fb = semBlocos(b);
  if (fa !== fb) {
    if (/<script|manifest|http-equiv|<base|<iframe/i.test(fa + fb) && fa.replace(/\s+/g, "") !== fb.replace(/\s+/g, "")) {
      const linhas = new Set(fa.split("\n")); const novas = fb.split("\n").filter((l) => !linhas.has(l));
      if (novas.some((l) => /<script|manifest|http-equiv|<base|<iframe/i.test(l))) funcional.push(`${f}: cabeçalho da página (scripts, manifesto ou configuração)`); else design.push(`${f}: marcação da página`);
    } else design.push(`${f}: marcação da página`);
  }
  const sa = blocos(a, "script").join("\n;\n"), sb = blocos(b, "script").join("\n;\n");
  if (sa === sb) return;
  let la, lb;
  try { la = sinais(sa).map((x) => x.v).join(" "); lb = sinais(sb).map((x) => x.v).join(" "); }
  catch (e) { funcional.push(`${f}: o código da proposta não pôde ser lido (${e.message})`); return; }
  if (la === lb) { design.push(`${f}: visual e textos das telas (lógica idêntica)`); return; }
  const ma = funcoes(sa), mb = funcoes(sb), alt = [];
  for (const [n, x] of mb) { if (!ma.has(n)) alt.push(`+ ${n} (nova)`); else if (ma.get(n).logica !== x.logica) alt.push(`~ ${n} (lógica alterada)`); }
  for (const n of ma.keys()) if (!mb.has(n)) alt.push(`- ${n} (removida)`);
  funcional.push(`${f}: lógica do app alterada${alt.length ? ":\n    " + alt.slice(0, 40).join("\n    ") + (alt.length > 40 ? `\n    …e mais ${alt.length - 40}` : "") : " (fora de funções nomeadas)"}`);
}

// ---------- classificação por arquivo ----------
let appMudou = false;
for (const f of arquivos) {
  if (f.startsWith("app/")) continue; // gerado: conferido pela montagem abaixo
  if (COM_CODIGO.includes(f)) { appMudou = true; compararArquivoComCodigo(f); continue; }
  if (f === "prototipo/versao.json") continue; // conferida abaixo
  if (DESIGN_ARQ.test(f)) { design.push(`${f}: imagem ou fonte`); appMudou = appMudou || f.startsWith("prototipo/"); continue; }
  if (DOC_ARQ.test(f)) { design.push(`${f}: documentação`); continue; }
  if (ler(PROP, f) === null) { funcional.push(`${f}: arquivo removido`); continue; }
  funcional.push(`${f}: ${/servidor-marco|supabase/.test(f) ? "servidor do Marco / nuvem" : /\.github|\.githooks/.test(f) ? "rotina de publicação ou segurança" : /\.gitignore|\.gitattributes|nuvem\.json|verificar|testar|classificar|publicar|montar/.test(f) ? "configuração, trava ou ferramenta de segurança" : "arquivo de funcionamento"}`);
}

// ---------- versão: subir sempre que o app muda; nunca rebaixar ----------
const vA = JSON.parse(ler(BASE, "prototipo/versao.json") || '{"versao":"0.0.0"}').versao, vB = JSON.parse(ler(PROP, "prototipo/versao.json") || '{"versao":"0.0.0"}').versao;
const num = (v) => v.split(".").map(Number), cmp = (x, y) => { const a = num(x), b = num(y); for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] - b[i]; return 0; };
if (cmp(vB, vA) < 0) funcional.push(`prototipo/versao.json: rebaixa a versão (${vA} → ${vB})`);
else if (appMudou && cmp(vB, vA) === 0) funcional.push(`prototipo/versao.json: o app mudou mas a versão continua ${vA} (correção visual: suba o último número, ex.: ${vA.replace(/\d+$/, (n) => +n + 1)})`);
else if (cmp(vB, vA) > 0) design.push(`prototipo/versao.json: versão ${vA} → ${vB}`);

// ---------- app/ precisa ser a montagem do código-fonte da proposta ----------
if (arquivos.some((f) => f.startsWith("app/")) || appMudou) {
  try {
    fs.copyFileSync(path.join(BASE, "prototipo", "montar.mjs"), path.join(PROP, "prototipo", "montar.mjs")); // ferramenta da versão corrente
    execSync("node prototipo/montar.mjs", { cwd: PROP, stdio: "ignore" });
    const dif = execSync("git status --porcelain app/", { cwd: PROP, encoding: "utf8" }).trim();
    if (dif) funcional.push(`app/: os arquivos enviados não correspondem à montagem do código-fonte (rode "node prototipo/montar.mjs" antes de enviar)`);
  } catch (e) { funcional.push(`app/: a montagem da proposta falhou (${String(e.message).slice(0, 120)})`); }
}

// ---------- relatório ----------
const ok = funcional.length === 0;
let md = ok
  ? `## Revisão de colaboração: só design ✅\n\nA lógica, a segurança e o funcionamento do app continuam idênticos à versão corrente. A proposta pode entrar.\n\n`
  : `## Revisão de colaboração: precisa de análise ⛔\n\nEsta proposta muda o **funcionamento** do app (ou rotinas de segurança). Pela regra de colaboração, ela **não substituiu** a versão corrente: os arquivos ficam guardados nesta branch até a aprovação do Wagner.\n\n### O que muda no funcionamento\n${funcional.map((x) => "- " + x).join("\n")}\n\n`;
if (design.length) md += `### Mudanças de design\n${design.map((x) => "- " + x).join("\n")}\n`;
if (!arquivos.length) md += "Nenhum arquivo diferente da versão corrente.\n";
if (SAIDA) fs.writeFileSync(SAIDA, md);
console.log(md);
process.exit(ok ? 0 : 2);
