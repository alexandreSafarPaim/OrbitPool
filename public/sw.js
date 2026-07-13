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

const VERSION = 'orbitpool-v3';
const SHELL = [
  './',
  'index.html',
  'rules.js', 'physics.js', 'game3d.js', 'bot.js', 'net.js', 'ranked.js', 'auth.js', 'audio.js', 'menu.js', 'i18n.js',
  'table3d_collider.js', 'GLTFLoader.js', 'OBJLoader.js',
  'favicon.svg', 'icon-192.png', 'icon-512.png', 'site.webmanifest',
];
const SKIP = /\/music\/|\/env\/cube\//; // pesados demais p/ cache

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(VERSION)
      // um 404 em UM arquivo não pode brickar a atualização inteira (addAll
      // rejeita tudo) — cacheia individualmente e ignora falhas pontuais
      .then((c) => Promise.all(SHELL.map((u) => c.add(u).catch(() => {}))))
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

  const isCode = /\.(js|html)$/.test(url.pathname) || url.pathname.endsWith('/');
  e.respondWith(
    caches.open(VERSION).then((cache) =>
      cache.match(req).then((cached) => {
        const fetching = fetch(req)
          .then((res) => {
            if (res && res.ok) cache.put(req, res.clone());
            return res;
          })
          .catch(() => cached); // offline: usa o cache (ou falha se nunca visto)
        // CÓDIGO (html/js): NETWORK-FIRST — online sempre roda a versão mais
        // nova (senão o jogador testa com JS velho); offline cai pro cache.
        // ASSETS (texturas/glb/fontes): stale-while-revalidate (rápido).
        return isCode ? fetching : (cached || fetching);
      })
    )
  );
});
