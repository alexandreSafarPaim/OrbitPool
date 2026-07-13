/* =========================================================================
   OrbitPool — cliente do modo RANQUEADO (servidor autoritativo Cloudflare).
   • base: URL do Worker (sobrescrevível p/ testes locais via
     localStorage 'orbitpool.rankedUrl', ex.: 'http://127.0.0.1:8787').
   • getToken(): fase 3 pluga Firebase (site) / SDK CrazyGames (portal) via
     window.OrbitAuth. Sem provedor, em host local gera token dev (o servidor
     só aceita com ALLOW_DEV_AUTH=true, ou seja, nunca em produção).
   • leaderboard(): top da temporada (cache de 60s no edge).
   ========================================================================= */
'use strict';

window.OrbitRanked = {
  get base() {
    try { const o = localStorage.getItem('orbitpool.rankedUrl'); if (o) return o.replace(/\/+$/, ''); } catch (e) {}
    return 'https://orbitpool-ranked.botecorbitpool.workers.dev';
  },
  wsBase() { return this.base.replace(/^http/, 'ws'); },

  async getToken(name) {
    // Provedor real: Firebase no site (a UI de login fica no menu) /
    // SDK do CrazyGames no portal. Sem sessão → null (o menu abre o modal).
    if (window.OrbitAuth && OrbitAuth.getToken) {
      try { return await OrbitAuth.getToken(); } catch (e) { return null; }
    }
    // Sem OrbitAuth (falha de CDN) em ambiente local: token dev p/ testes.
    if (/^(localhost|127\.|192\.168\.|10\.)/.test(location.hostname)) {
      let id; // por ABA (sessionStorage): duas abas = dois jogadores no teste
      try {
        id = sessionStorage.getItem('orbitpool.devid');
        if (!id) { id = 'g' + Math.random().toString(36).slice(2, 10); sessionStorage.setItem('orbitpool.devid', id); }
      } catch (e) { id = 'g' + Math.random().toString(36).slice(2, 10); }
      const json = JSON.stringify({ id, name: name || 'Convidado' });
      const b64u = btoa(unescape(encodeURIComponent(json))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
      return 'dev.' + b64u;
    }
    return null;
  },

  async me() {
    const t = await this.getToken();
    if (!t) return null;
    const r = await fetch(this.base + '/api/me', { headers: { Authorization: 'Bearer ' + t } });
    if (!r.ok) throw new Error('me http ' + r.status);
    return r.json();
  },

  async leaderboard(limit) {
    const r = await fetch(this.base + '/api/leaderboard' + (limit ? '?limit=' + limit : ''));
    if (!r.ok) throw new Error('leaderboard http ' + r.status);
    return r.json();
  },
};
