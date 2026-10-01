// Service worker: guarda o app no aparelho para funcionar sem internet.
// Ao publicar uma versão nova, troque o número em CACHE para o celular baixar os arquivos novos.
const CACHE = 'finviagem-v1.15.0';
const ARQUIVOS = ['./', 'index.html', 'manifest.webmanifest', 'icon-192.png', 'icon-512.png', 'icon-maskable-512.png', 'lib/qrcode.js', 'lib/jsQR.js'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ARQUIVOS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys()
    .then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

// Primeiro a cópia guardada (abre na hora, mesmo sem sinal); em paralelo busca a versão nova quando há internet.
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  e.respondWith(caches.match(e.request, { ignoreSearch: true }).then(guardado => {
    const rede = fetch(e.request).then(r => {
      if (r && r.ok && new URL(e.request.url).origin === location.origin) caches.open(CACHE).then(c => c.put(e.request, r.clone()));
      return r;
    }).catch(() => guardado);
    return guardado || rede;
  }));
});
