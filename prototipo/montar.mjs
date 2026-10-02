// Monta o app Clé a partir do molde (app.html) e da Carteira (carteira/index.html).
// Gera:
//   ../app/                         o app "virgem" e instalável (PWA): index.html, manifest, sw.js, ícones,
//                                   carteira/lib (leitor de QR) — nenhum dado de viagem dentro
//   ./index.html                    a mesma página, para o link publicado no Claude
// Rodar:  node montar.mjs

import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const RAIZ = path.join(HERE, "..");
const APP = path.join(RAIZ, "app");

// ---------- 1. o app (sem dados) ----------
const carteira = fs.readFileSync(path.join(HERE, "carteira", "index.html"), "utf8");
const seguro = (s) => JSON.stringify(s).replace(/<\/script/gi, "<\\/script").replace(/<!--/g, "<\\!--");
// número da versão (padrão da Carteira): prototipo/versao.json; a trava de publicação exige subir a cada mudança
const VERSAO_APP = JSON.parse(fs.readFileSync(path.join(HERE, "versao.json"), "utf8")).versao;
if (!/^\d+\.\d+\.\d+$/.test(VERSAO_APP)) throw new Error("app NÃO gerado: versão inválida em prototipo/versao.json (use 1.0.0)");
// fotos da tela de interesses: prototipo/imagens/interesses/<nome-do-interesse>.(webp|jpg|png|avif), copiadas para
// app/imagens/interesses/ com a impressão do conteúdo no endereço (troca de foto = celular baixa a nova)
const DIR_FOTOS = path.join(HERE, "imagens", "interesses"), APP_FOTOS = path.join(APP, "imagens", "interesses");
const FOTOS_INTERESSES = {}, arquivosFotos = [];
fs.rmSync(APP_FOTOS, { recursive: true, force: true });
if (fs.existsSync(DIR_FOTOS)) {
  fs.mkdirSync(APP_FOTOS, { recursive: true });
  for (const f of fs.readdirSync(DIR_FOTOS).filter((x) => /\.(webp|jpe?g|png|avif)$/i.test(x))) {
    const buf = fs.readFileSync(path.join(DIR_FOTOS, f)), slug = f.replace(/\.[^.]+$/, "").toLowerCase();
    if (buf.length > 700 * 1024) console.warn(`  aviso: ${f} tem ${Math.round(buf.length / 1024)} KB; o ideal é até 350 KB (veja imagens/interesses/LEIA-ME.md)`);
    fs.copyFileSync(path.join(DIR_FOTOS, f), path.join(APP_FOTOS, f));
    FOTOS_INTERESSES[slug] = `imagens/interesses/${f}?v=${crypto.createHash("sha256").update(buf).digest("hex").slice(0, 8)}`;
    arquivosFotos.push("./" + FOTOS_INTERESSES[slug]); // o mesmo endereço que o app pede, para funcionar sem internet
  }
}
const html = fs.readFileSync(path.join(HERE, "app.html"), "utf8")
  .replace("/*__MONTADO__*/false", "true")
  .replace("/*__FOTOS_INTERESSES__*/{}", () => JSON.stringify(FOTOS_INTERESSES))
  // ponto de interesse de cada foto (onde o recorte do cartão estreito se centraliza): imagens/interesses/foco.json
  .replace("/*__FOCO_INTERESSES__*/{}", () => { const f = path.join(DIR_FOTOS, "foco.json"); return fs.existsSync(f) ? JSON.stringify(JSON.parse(fs.readFileSync(f, "utf8"))) : "{}"; })
  .replace('/*__VERSAO__*/"dev"', () => JSON.stringify(VERSAO_APP))
  .replace("/*__CARTEIRA__*/null", () => seguro(carteira))
  // endereço do Marco na nuvem (público; gravado por publicar-nuvem.mjs). Sem ele, o app publicado avisa que o Marco não está ligado
  .replace("/*__NUVEM__*/null", () => { const f = path.join(HERE, "nuvem.json"); return fs.existsSync(f) ? JSON.stringify(JSON.parse(fs.readFileSync(f, "utf8"))) : "null"; });

// trava: o código do app é um único <script>; qualquer "</script" antes do fim o corta ao meio e o resto
// aparece como texto na tela (bug de 30/09/2026). Recusa gerar se isso acontecer.
const ini = html.indexOf("<script>"), fechos = [...html.slice(ini).matchAll(/<\/script/gi)];
if (fechos.length !== 1) {
  for (const m of fechos.slice(0, -1)) console.error("  </script> prematuro perto de:", JSON.stringify(html.slice(ini + m.index - 60, ini + m.index + 10)));
  throw new Error(`app NÃO gerado: ${fechos.length - 1} fechamento(s) de <script> antes do fim do código. Escreva <\\/script> dentro de textos.`);
}
// trava: o app publicado não pode levar dados pessoais de viagens de exemplo. Os nomes proibidos
// (hotéis, pontos de partida) são lidos dos arquivos em ../exemplos/, que existem só no computador do autor.
for (const nome of nomesPrivados()) {
  if (html.includes(nome)) throw new Error(`app NÃO gerado: encontrou "${nome}" (dado de uma viagem de exemplo) no código. O app precisa sair vazio.`);
}
function nomesPrivados() {
  const dir = path.join(HERE, "..", "exemplos"), nomes = new Set();
  if (!fs.existsSync(dir)) return nomes;
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith(".json"))) {
    try {
      const d = JSON.parse(fs.readFileSync(path.join(dir, f), "utf8"));
      for (const dia of (d.roteiro && d.roteiro.dias) || []) for (const p of dia.paradas) if (p.t === "pernoite" || p.t === "inicio") nomes.add(p.n.split(" - ")[0].trim());
      for (const x of (d.estado && d.estado.listas && d.estado.listas.cofre) || []) if (x.s && x.s.length > 6) nomes.add(x.s);
    } catch (e) {}
  }
  return [...nomes].filter((n) => n.length > 6);
}

fs.mkdirSync(path.join(APP, "carteira", "lib"), { recursive: true });
// o app instalável é um documento completo: sem a meta viewport, o celular finge uma tela de computador
// (~980 px) e o app aparece miniaturizado (bug de 01/10/2026). Trava: recusa gerar sem ela.
const CABECA = '<!doctype html>\n<html lang="pt-BR">\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">\n';
const htmlApp = CABECA + html;
if (!/<meta name="viewport" content="width=device-width/.test(htmlApp)) throw new Error("app NÃO gerado: falta a meta viewport");
fs.writeFileSync(path.join(APP, "index.html"), htmlApp);
fs.writeFileSync(path.join(HERE, "index.html"), html);
// versão publicada, consultada pelo app (sem cache) para avisar que há versão nova mesmo se o service worker travar
fs.writeFileSync(path.join(APP, "versao.json"), JSON.stringify({ versao: VERSAO_APP }) + "\n");
for (const f of ["lib/qrcode.js", "lib/jsQR.js", "lib/LICENCAS.txt", "icon-192.png"]) {
  const de = path.join(HERE, "carteira", f);
  if (fs.existsSync(de)) fs.copyFileSync(de, path.join(APP, "carteira", f));
}

// ---------- 2. ícones (gerados aqui: fundo azul-ardósia com a bússola do Marco) ----------
function png(tam, { arredondado }) {
  const AA = 4, cor = [0x24, 0x47, 0x6b], k = (0.3 * tam) / 9, c0 = tam / 2;
  const P = [[15.5, 8.5], [13.5, 13.5], [8.5, 15.5], [10.5, 10.5]].map(([x, y]) => [c0 + (x - 12) * k, c0 + (y - 12) * k]);
  const dentro = (x, y) => { let s = false; for (let i = 0, j = P.length - 1; i < P.length; j = i++) { const [xi, yi] = P[i], [xj, yj] = P[j]; if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) s = !s; } return s; };
  const raio = 9 * k, larg = 1.9 * k, cant = arredondado ? tam * 0.22 : 0;
  const linhas = [];
  for (let y = 0; y < tam; y++) {
    const l = Buffer.alloc(1 + tam * 4);
    for (let x = 0; x < tam; x++) {
      let fundo = 0, branco = 0;
      for (let sy = 0; sy < AA; sy++) for (let sx = 0; sx < AA; sx++) {
        const px = x + (sx + 0.5) / AA, py = y + (sy + 0.5) / AA;
        const dx = Math.max(cant - px, px - (tam - cant), 0), dy = Math.max(cant - py, py - (tam - cant), 0);
        if (cant && Math.hypot(dx, dy) > cant) continue;
        fundo++;
        const d = Math.hypot(px - c0, py - c0);
        if (Math.abs(d - raio) <= larg / 2 || dentro(px, py)) branco++;
      }
      const a = fundo / (AA * AA), w = fundo ? branco / fundo : 0, o = 1 + x * 4;
      for (let ch = 0; ch < 3; ch++) l[o + ch] = Math.round(cor[ch] + (255 - cor[ch]) * w);
      l[o + 3] = Math.round(a * 255);
    }
    linhas.push(l);
  }
  const crcT = Array.from({ length: 256 }, (_, n) => { let c = n; for (let i = 0; i < 8; i++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
  const crc = (b) => { let c = 0xffffffff; for (const v of b) c = crcT[(c ^ v) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const bloco = (tipo, dados) => { const t = Buffer.from(tipo), len = Buffer.alloc(4), cr = Buffer.alloc(4); len.writeUInt32BE(dados.length); cr.writeUInt32BE(crc(Buffer.concat([t, dados]))); return Buffer.concat([len, t, dados, cr]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(tam, 0); ihdr.writeUInt32BE(tam, 4); ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), bloco("IHDR", ihdr), bloco("IDAT", zlib.deflateSync(Buffer.concat(linhas))), bloco("IEND", Buffer.alloc(0))]);
}
fs.writeFileSync(path.join(APP, "icon-192.png"), png(192, { arredondado: true }));
fs.writeFileSync(path.join(APP, "icon-512.png"), png(512, { arredondado: true }));
fs.writeFileSync(path.join(APP, "icon-maskable-512.png"), png(512, { arredondado: false }));

// ---------- 3. manifest e service worker (offline) ----------
fs.writeFileSync(path.join(APP, "manifest.webmanifest"), JSON.stringify({
  name: "Clé", short_name: "Clé", description: "Planeje e viva a viagem conversando com o Marco.",
  lang: "pt-BR", start_url: "./", scope: "./", display: "standalone", orientation: "any",
  background_color: "#F2F2F7", theme_color: "#24476B",
  icons: [
    { src: "icon-192.png", sizes: "192x192", type: "image/png" },
    { src: "icon-512.png", sizes: "512x512", type: "image/png" },
    { src: "icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
  ],
}, null, 2));
const arquivos = [...arquivosFotos, "./", "./index.html", "./manifest.webmanifest", "./icon-192.png", "./icon-512.png", "./icon-maskable-512.png", "./carteira/lib/qrcode.js", "./carteira/lib/jsQR.js", "./carteira/icon-192.png"];
const versao = crypto.createHash("sha256").update(htmlApp).update(fs.readFileSync(path.join(APP, "carteira/lib/jsQR.js"))).digest("hex").slice(0, 10);
fs.writeFileSync(path.join(APP, "sw.js"), `// Clé: funciona sem internet depois da primeira abertura (gerado por prototipo/montar.mjs)
const VERSAO = "cle-v${VERSAO_APP}-${versao}";
const ARQUIVOS = ${JSON.stringify(arquivos)};
const FONTES = /^https:\\/\\/fonts\\.(googleapis|gstatic)\\.com\\//;
// o GitHub Pages manda o navegador guardar cada arquivo por 10 min: a versão nova é baixada direto do servidor
// (cache: "reload"), senão o app avisaria "versão nova" e continuaria mostrando a antiga (bug de 01/10/2026)
self.addEventListener("install", (e) => { e.waitUntil(caches.open(VERSAO).then((c) => c.addAll(ARQUIVOS.map((u) => new Request(u, { cache: "reload" })))).then(() => self.skipWaiting())); });
self.addEventListener("activate", (e) => { e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== VERSAO && !k.startsWith("cle-voz-")).map((k) => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener("fetch", (e) => {
  const r = e.request;
  if (r.method !== "GET") return;
  if (r.mode === "navigate") { e.respondWith(fetch(r.url, { cache: "no-cache", credentials: "same-origin" }).then((resp) => { const cp = resp.clone(); caches.open(VERSAO).then((c) => c.put("./index.html", cp)); return resp; }).catch(() => caches.match("./index.html"))); return; }
  if (FONTES.test(r.url)) { e.respondWith(caches.match(r).then((m) => m || fetch(r).then((resp) => { const cp = resp.clone(); caches.open(VERSAO).then((c) => c.put(r, cp)); return resp; }))); return; }
  if (new URL(r.url).origin === location.origin) e.respondWith(caches.match(r).then((m) => m || fetch(r)));
});
`);

console.log(`app v${VERSAO_APP}: app/index.html (${Math.round(Buffer.byteLength(html) / 1024)} KB, versão ${versao}) · ícones, manifest e sw.js gerados`);
