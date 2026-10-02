// Clé: funciona sem internet depois da primeira abertura (gerado por prototipo/montar.mjs)
const VERSAO = "cle-v1.8.0-f8b7760d05";
const ARQUIVOS = ["./imagens/interesses/aventura-radical.webp?v=252b5dec","./imagens/interesses/bem-estar.webp?v=6b68497b","./imagens/interesses/carros-e-estradas-cenicas.webp?v=502a7fbc","./imagens/interesses/cidades.webp?v=a5c28a61","./imagens/interesses/compras.webp?v=613104d8","./imagens/interesses/cultura-local.webp?v=fe4a02d5","./imagens/interesses/esportes.webp?v=21ae379d","./imagens/interesses/fotografia.webp?v=70f63544","./imagens/interesses/gastronomia.webp?v=26ea4b54","./imagens/interesses/museus-e-historia.webp?v=78e46128","./imagens/interesses/natureza-e-parques.webp?v=9373725f","./imagens/interesses/parques-tematicos.webp?v=0cf31327","./imagens/interesses/praia.webp?v=28101939","./imagens/interesses/shows-e-musica.webp?v=68e7758f","./imagens/interesses/trilhas.webp?v=4595374a","./imagens/interesses/vida-noturna.webp?v=8bcee2a3","./","./index.html","./manifest.webmanifest","./icon-192.png","./icon-512.png","./icon-maskable-512.png","./carteira/lib/qrcode.js","./carteira/lib/jsQR.js","./carteira/icon-192.png"];
const FONTES = /^https:\/\/fonts\.(googleapis|gstatic)\.com\//;
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
