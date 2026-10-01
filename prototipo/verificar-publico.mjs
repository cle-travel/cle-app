// Trava antes de cada envio ao repositório PÚBLICO: confere tudo o que o Git vai publicar e bloqueia
// se encontrar chave de API, arquivo proibido ou dado pessoal da viagem de exemplo.
// Roda sozinho antes de cada commit (gancho em .git/hooks/pre-commit). Também dá para rodar à mão:
//   node prototipo/verificar-publico.mjs

import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const RAIZ = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const arquivos = execSync("git ls-files --cached --others --exclude-standard", { cwd: RAIZ, encoding: "utf8" }).split("\n").filter(Boolean);

// .env.exemplo pode (é o modelo vazio); qualquer outro .env, nunca
const CAMINHOS_PROIBIDOS = [/(^|\/)\.env(?!\.exemplo$)/, /(^|\/)node_modules\//, /^servidor-marco\/consumo\//, /^memoria\//, /^relatorios\//,/^ANALISE/i, /^exemplos\//, /^validacoes\//, /ESPECIFICACAO/i, /ONBOARDING\.md$/, /^seguranca\//, /recovery-codes/i, /^design\//, /\.bak$/];
const CONTEUDO_PROIBIDO = [
  [/sk-ant-[A-Za-z0-9_-]{8,}/, "chave da Anthropic"],
  [/sbp_[A-Za-z0-9]{20,}/, "token da conta Supabase"],
  [/^[A-Z_]+_(KEY|TOKEN)=\S+/m, "chave preenchida num arquivo de modelo"],
  [/sk_car_[A-Za-z0-9]{8,}/, "chave da Cartesia"],
  [/AIza[0-9A-Za-z_-]{30,}/, "chave do Google"],
  [/\bpk\.[A-Za-z0-9_-]{40,}/, "chave do Mapbox"],
  [/\b[a-f0-9]{48,}\b/, "possível chave (ElevenLabs/Foursquare)"],
];
// nomes de hotéis, carro e pontos de partida das viagens de exemplo: lidos dos arquivos locais em exemplos/
// (que nunca vão para o repositório), para que nenhum deles fique escrito aqui
const privados = new Set();
const dirEx = path.join(RAIZ, "exemplos");
if (fs.existsSync(dirEx)) for (const f of fs.readdirSync(dirEx).filter((x) => x.endsWith(".json"))) {
  try {
    const d = JSON.parse(fs.readFileSync(path.join(dirEx, f), "utf8"));
    for (const dia of (d.roteiro && d.roteiro.dias) || []) for (const p of dia.paradas) if (p.t === "pernoite" || p.t === "inicio") privados.add(p.n.split(" - ")[0].trim());
    for (const x of (d.estado && d.estado.listas && d.estado.listas.cofre) || []) if (x.s && x.s.length > 6) privados.add(x.s);
  } catch (e) {}
}
// códigos de acesso dos testadores (seguranca/testadores.json): nunca podem aparecer em arquivo publicado
const arqTest = path.join(RAIZ, "seguranca", "testadores.json");
if (fs.existsSync(arqTest)) { try { for (const c of Object.values(JSON.parse(fs.readFileSync(arqTest, "utf8")))) if (typeof c === "string" && c.length > 8) privados.add(c); } catch (e) {} }
// e-mails dos testadores (seguranca/permitidos.json): nunca podem aparecer em arquivo publicado
const arqPerm = path.join(RAIZ, "seguranca", "permitidos.json");
if (fs.existsSync(arqPerm)) { try { for (const e of Object.values(JSON.parse(fs.readFileSync(arqPerm, "utf8")))) if (typeof e === "string" && e.includes("@")) privados.add(e.trim()); } catch (e) {} }
// termos pessoais (nomes, documentos, e-mails): lista privada em exemplos/termos-privados.txt, nunca escrita aqui
const termosEx = path.join(dirEx, "termos-privados.txt");
if (fs.existsSync(termosEx)) for (const l of fs.readFileSync(termosEx, "utf8").split(/\r?\n/)) { const t = l.trim(); if (t && !t.startsWith("#")) privados.add(t); }
const problemas = [];
for (const f of arquivos) {
  if (CAMINHOS_PROIBIDOS.some((re) => re.test(f))) { problemas.push(`${f}: arquivo que não pode ser público`); continue; }
  if (!/\.(html|js|mjs|json|md|txt|webmanifest|yml|yaml|exemplo|ts|sql|toml)$/i.test(f)) continue;
  const txt = fs.readFileSync(path.join(RAIZ, f), "utf8");
  for (const [re, motivo] of CONTEUDO_PROIBIDO) {
    if (f.endsWith("verificar-publico.mjs")) break; // este arquivo descreve os padrões
    const m = txt.match(re);
    if (m) problemas.push(`${f}: ${motivo} ("${m[0].slice(0, 12)}…")`);
  }
  for (const n of privados) if (n.length > 5 && txt.toLowerCase().includes(n.toLowerCase())) problemas.push(`${f}: dado da viagem de exemplo ("${n.slice(0, 12)}…")`);
}
// o app publicado mudou? então a versão (prototipo/versao.json) precisa subir no mesmo envio
let noEnvio = [];
try { noEnvio = execSync("git diff --cached --name-only", { cwd: RAIZ, encoding: "utf8" }).split("\n").filter(Boolean); } catch (e) {}
if (noEnvio.includes("app/index.html") && !noEnvio.includes("prototipo/versao.json")) {
  let antes = null; try { antes = JSON.parse(execSync("git show HEAD:prototipo/versao.json", { cwd: RAIZ, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] })).versao; } catch (e) {}
  if (antes !== null) problemas.push(`app/index.html mudou, mas a versão continua ${antes}: suba o número em prototipo/versao.json (correção 1.0.1, recurso novo 1.1.0, mudança grande 2.0.0)`);
}
if (problemas.length) {
  console.error("ENVIO BLOQUEADO. O repositório é público e estes itens não podem ir para lá:\n  " + problemas.join("\n  "));
  process.exit(1);
}
console.log(`ok: ${arquivos.length} arquivo(s) conferidos, nada proibido.`);
