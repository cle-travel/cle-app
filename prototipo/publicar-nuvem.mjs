// Publica o Marco na nuvem (Supabase Edge Function "api") com um comando:  node prototipo/publicar-nuvem.mjs
//
// Precisa de (tudo PRIVADO, na pasta seguranca/, que nunca vai para o GitHub):
//   seguranca/supabase.json     { "ref": "<id do projeto>", "token": "<token de acesso da conta Supabase>" }
//   seguranca/testadores.json   { "Wagner": "<código>", ... }  (criado aqui na primeira vez, com códigos aleatórios)
// E das chaves de servidor-marco/.env (Anthropic, Mapbox, Foursquare, NPS).
//
// O que faz: copia o núcleo do Marco para a função; cria a tabela de consumo; grava os segredos no Supabase
// (nunca imprime nenhum); publica a função; grava a URL pública em prototipo/nuvem.json e remonta o app;
// testa a função com o código do Wagner.

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { execFileSync, execSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const RAIZ = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const SEG = path.join(RAIZ, "seguranca");
const lerJson = (f) => JSON.parse(fs.readFileSync(f, "utf8"));

// 1. credenciais da conta Supabase
const arqSupa = path.join(SEG, "supabase.json");
if (!fs.existsSync(arqSupa)) { console.error(`Falta ${arqSupa} com { "ref": "...", "token": "..." }. Veja o LEIA-ME da pasta seguranca.`); process.exit(1); }
const { ref, token } = lerJson(arqSupa);
if (!/^[a-z0-9]{20}$/.test(ref || "") || !String(token || "").startsWith("sbp_")) { console.error("seguranca/supabase.json: ref (20 letras/números) ou token (começa com sbp_) inválido."); process.exit(1); }
const API = `https://api.supabase.com/v1/projects/${ref}`;
const cab = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };

// 2. códigos de acesso dos testadores (gerados uma vez; legíveis e difíceis de adivinhar)
const arqTest = path.join(SEG, "testadores.json");
if (!fs.existsSync(arqTest)) {
  const letras = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // sem 0/O e 1/I, para não confundir ao digitar
  const codigo = () => "CLE-" + Array.from({ length: 3 }, () => Array.from(crypto.randomBytes(4), (b) => letras[b % letras.length]).join("")).join("-");
  const nomes = ["Wagner", "Arthur", "Sandro", "Alessandra", "Leonardo"];
  fs.writeFileSync(arqTest, JSON.stringify(Object.fromEntries(nomes.map((n) => [n, codigo()])), null, 2));
  console.log(`códigos de acesso criados em ${arqTest} (entregue cada um em particular)`);
}
const testadores = lerJson(arqTest);

// 3. núcleo do Marco → função (cópias geradas; a fonte única é servidor-marco/)
const SHARED = path.join(RAIZ, "supabase", "functions", "_shared");
fs.mkdirSync(SHARED, { recursive: true });
for (const f of ["http.mjs", "nucleo.mjs", "lugares.mjs", "rotas.mjs"]) {
  fs.writeFileSync(path.join(SHARED, f), `// GERADO por prototipo/publicar-nuvem.mjs a partir de servidor-marco/${f}. Não editar aqui.\n` + fs.readFileSync(path.join(RAIZ, "servidor-marco", f), "utf8"));
}
console.log("núcleo copiado para a função");

// 4. tabela de consumo
const sql = fs.readFileSync(path.join(RAIZ, "supabase", "migrations", "20261001000000_consumo.sql"), "utf8");
let r = await fetch(`${API}/database/query`, { method: "POST", headers: cab, body: JSON.stringify({ query: sql }) });
if (!r.ok) { console.error("tabela de consumo: falhou", r.status, (await r.text()).slice(0, 200)); process.exit(1); }
console.log("tabela de consumo pronta");

// 5. segredos (valores nunca impressos)
const env = {}; for (const l of fs.readFileSync(path.join(RAIZ, "servidor-marco", ".env"), "utf8").split(/\r?\n/)) { const m = l.match(/^([A-Z_]+)=(.*)$/); if (m && m[2].trim()) env[m[1]] = m[2].trim(); }
const segredos = ["ANTHROPIC_API_KEY", "MAPBOX_TOKEN", "FOURSQUARE_API_KEY", "NPS_API_KEY", "LIMITE_DIARIO_USD"].filter((k) => env[k]).map((k) => ({ name: k, value: env[k] }));
segredos.push({ name: "TESTADORES", value: JSON.stringify(testadores) });
// contas liberadas para o Marco (e-mail de cada testador): seguranca/permitidos.json { "Wagner": "email", ... }
const arqPerm = path.join(SEG, "permitidos.json");
if (fs.existsSync(arqPerm)) segredos.push({ name: "PERMITIDOS", value: JSON.stringify(lerJson(arqPerm)) });
if (!segredos.some((s) => s.name === "ANTHROPIC_API_KEY")) { console.error("Falta ANTHROPIC_API_KEY em servidor-marco/.env"); process.exit(1); }
r = await fetch(`${API}/secrets`, { method: "POST", headers: cab, body: JSON.stringify(segredos) });
if (!r.ok) { console.error("segredos: falhou", r.status, (await r.text()).slice(0, 200)); process.exit(1); }
console.log(`segredos gravados: ${segredos.map((s) => s.name).join(", ")}`);
// sem limite diário no .env: garante que um limite antigo não fique valendo na nuvem
if (!env.LIMITE_DIARIO_USD) await fetch(`${API}/secrets`, { method: "DELETE", headers: cab, body: JSON.stringify(["LIMITE_DIARIO_USD"]) });

// 6. publica a função (CLI oficial do Supabase, sem Docker)
console.log("publicando a função…");
// o ref já foi conferido acima (20 letras/números), então a linha de comando montada é segura
execSync(`npx --yes supabase@latest functions deploy api --project-ref ${ref} --no-verify-jwt --use-api`, { cwd: RAIZ, stdio: "inherit", env: { ...process.env, SUPABASE_ACCESS_TOKEN: token } });

// 7. URL pública no app e remontagem
const url = `https://${ref}.supabase.co/functions/v1/api`;
// preserva a chave pública de login (anon) e os provedores ativos (google/apple) já gravados
const arqNuvem = path.join(RAIZ, "prototipo", "nuvem.json");
const antes = fs.existsSync(arqNuvem) ? lerJson(arqNuvem) : {};
fs.writeFileSync(arqNuvem, JSON.stringify({ ...antes, url, supabase: `https://${ref}.supabase.co` }, null, 2) + "\n");
execFileSync(process.execPath, [path.join(RAIZ, "prototipo", "montar.mjs")], { stdio: "inherit" });

// 8. teste com o código do Wagner
const e = await (await fetch(url + "/estado", { headers: { "x-cle-acesso": testadores.Wagner, Origin: "https://cle-travel.github.io" } })).json();
const semCodigo = await (await fetch(url + "/estado")).json();
console.log(`teste: Marco ${e.marco ? "LIGADO" : "desligado"} para ${e.quem || "?"}${e.faltam && e.faltam.length ? ` (falta: ${e.faltam.join(", ")})` : ""} · sem código: ${semCodigo.acesso ? "ACESSO INDEVIDO" : "bloqueado (certo)"}`);
console.log(`URL do Marco na nuvem: ${url}`);
