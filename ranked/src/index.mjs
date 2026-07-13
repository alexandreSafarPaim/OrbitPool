/* =========================================================================
   Worker de entrada do ranqueado OrbitPool.
     GET /api/leaderboard        → top da temporada (cache 60s)
     GET /ws/queue?token=...     → fila de matchmaking (WebSocket)
     GET /ws/room/:id?token=...  → sala da partida (WebSocket)
   O token é verificado AQUI (Firebase/CrazyGames/dev) e a identidade segue
   para os Durable Objects via header interno X-User.
   ========================================================================= */
'use strict';

import { verifyToken } from './auth.mjs';
import { leaderboard, getStats, BASE_ELO } from './elo.mjs';
export { RankedRoom } from './room.mjs';
export { MatchQueue } from './queue.mjs';

function cors(env, req) {
  const origin = req.headers.get('Origin') || '';
  const allowed = (env.ALLOWED_ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean);
  const ok = allowed.includes(origin) || allowed.includes('*');
  return {
    'Access-Control-Allow-Origin': ok ? origin : (allowed[0] || ''),
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Vary': 'Origin',
  };
}
const json = (obj, status = 200, extra = {}) =>
  new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json', ...extra } });

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const h = cors(env, request);
    if (request.method === 'OPTIONS') return new Response(null, { headers: h });

    // ------------------------------------------------------- leaderboard
    if (url.pathname === '/api/leaderboard') {
      const cache = caches.default;
      const key = new Request(url.origin + '/api/leaderboard');
      let res = await cache.match(key);
      if (!res) {
        const data = await leaderboard(env.DB, Number(url.searchParams.get('limit')) || 50);
        res = json(data, 200, { 'Cache-Control': 'public, max-age=60' });
        ctx.waitUntil(cache.put(key, res.clone()));
      }
      res = new Response(res.body, res);
      for (const [k, v] of Object.entries(h)) res.headers.set(k, v);
      return res;
    }

    // ------------------------------------------------- meus stats (ELO)
    if (url.pathname === '/api/me') {
      const authz = request.headers.get('Authorization') || '';
      const token = authz.startsWith('Bearer ') ? authz.slice(7) : url.searchParams.get('token');
      const user = await verifyToken(token, env);
      if (!user) return json({ error: 'não autenticado' }, 401, h);
      const s = await getStats(env.DB, user.id);
      return json({
        id: user.id, name: (s && s.name) || user.name,
        elo: s ? s.elo : BASE_ELO, wins: s ? s.wins : 0, losses: s ? s.losses : 0,
      }, 200, h);
    }

    // -------------------------------------------------------- websockets
    const isQueue = url.pathname === '/ws/queue';
    const roomMatch = url.pathname.match(/^\/ws\/room\/([A-Za-z0-9-]{1,64})$/);
    if (isQueue || roomMatch) {
      if (request.headers.get('Upgrade') !== 'websocket') return json({ error: 'esperado websocket' }, 426);
      const user = await verifyToken(url.searchParams.get('token'), env);
      if (!user) return json({ error: 'token inválido — faça login' }, 401);

      const stub = isQueue
        ? env.MATCH_QUEUE.get(env.MATCH_QUEUE.idFromName('global'))
        : env.RANKED_ROOM.get(env.RANKED_ROOM.idFromName(roomMatch[1]));

      const fwd = new Request('https://do/ws', request);
      fwd.headers.set('X-User', JSON.stringify(user));
      return stub.fetch(fwd);
    }

    return json({ error: 'rota inválida' }, 404, h);
  },
};
