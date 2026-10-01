// Clé: funciona sem internet depois da primeira abertura (gerado por prototipo/montar.mjs)
const VERSAO = "cle-3a6c03ef06";
const ARQUIVOS = ["./","./index.html","./manifest.webmanifest","./icon-192.png","./icon-512.png","./icon-maskable-512.png","./carteira/lib/qrcode.js","./carteira/lib/jsQR.js","./carteira/icon-192.png"];
const FONTES = /^https:\/\/fonts\.(googleapis|gstatic)\.com\//;
self.addEventListener("install", (e) => { e.waitUntil(caches.open(VERSAO).then((c) => c.addAll(ARQUIVOS)).then(() => self.skipWaiting())); });
self.addEventListener("activate", (e) => { e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== VERSAO).map((k) => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener("fetch", (e) => {
  const r = e.request;
  if (r.method !== "GET") return;
  if (r.mode === "navigate") { e.respondWith(fetch(r).then((resp) => { const cp = resp.clone(); caches.open(VERSAO).then((c) => c.put("./index.html", cp)); return resp; }).catch(() => caches.match("./index.html"))); return; }
  if (FONTES.test(r.url)) { e.respondWith(caches.match(r).then((m) => m || fetch(r).then((resp) => { const cp = resp.clone(); caches.open(VERSAO).then((c) => c.put(r, cp)); return resp; }))); return; }
  if (new URL(r.url).origin === location.origin) e.respondWith(caches.match(r).then((m) => m || fetch(r)));
});
