/* =========================================================================
   OrbitPool — Service Worker (PWA).
   Estratégia:
     • PRECACHE do shell (HTML + JS + ícones) na instalação;
     • runtime cache "stale-while-revalidate" para assets same-origin
       (texturas, GLB, fontes ficam disponíveis offline após o 1º uso);
     • NUNCA cacheia /music/ (17MB+) nem env/cube (pesado) — rede direto,
       com falha silenciosa offline (o jogo segue sem música/fundo).
   Offline: o modo treino (bot) funciona 100%; multiplayer exige rede.
   ========================================================================= */
'use strict';

const VERSION = 'orbitpool-v1';
const SHELL = [
  './',
  'index.html',
  'physics.js', 'game3d.js', 'bot.js', 'net.js', 'audio.js', 'menu.js',
  'table3d_collider.js', 'GLTFLoader.js', 'OBJLoader.js',
  'favicon.svg', 'icon-192.png', 'icon-512.png', 'site.webmanifest',
];
const SKIP = /\/music\/|\/env\/cube\//; // pesados demais p/ cache

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(VERSION)
      .then((c) => c.addAll(SHELL))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return;       // CDNs/fonts: comportamento padrão
  if (SKIP.test(url.pathname)) return;               // música/ambiente: só rede

  // stale-while-revalidate: responde do cache e atualiza por trás
  e.respondWith(
    caches.open(VERSION).then((cache) =>
      cache.match(req).then((cached) => {
        const fetching = fetch(req)
          .then((res) => {
            if (res && res.ok) cache.put(req, res.clone());
            return res;
          })
          .catch(() => cached); // offline: fica no cache (ou falha se nunca visto)
        return cached || fetching;
      })
    )
  );
});
