/* =========================================================================
   OrbitPool — adapter do PORTAL (CrazyGames). Este arquivo SUBSTITUI o
   auth.js na build do portal (npm run build:cg) e adiciona:
     • OrbitAuth compatível: login = conta CrazyGames (showAuthPrompt);
       token = getUserToken() → o Worker já valida JWT 'cg:' (auth.mjs).
     • OrbitAds: eventos de loading/gameplay + intersticial 'midgame' no fim
       de partida (mute automático durante o anúncio, como o SDK exige).
   Fora do CrazyGames (environment 'disabled') tudo vira no-op seguro.
   ========================================================================= */
'use strict';

window.OrbitPortal = 'crazygames';

(function () {
  const SDK = () => (window.CrazyGames && window.CrazyGames.SDK) || null;
  let ready = null, sdkUser = null;
  const listeners = [];

  const shim = () => (sdkUser ? {
    uid: 'cg', isAnonymous: false,
    displayName: sdkUser.username || 'Jogador',
    photoURL: sdkUser.profilePictureUrl || '',
  } : null);
  const notify = () => { for (const cb of listeners) { try { cb(shim()); } catch (e) {} } };

  function load() {
    if (ready) return ready;
    ready = (async () => {
      if (!SDK()) throw new Error('SDK ausente');
      await SDK().init();
      try { SDK().game.loadingStart(); } catch (e) {}
      const env = SDK().environment;
      if (env !== 'crazygames' && env !== 'local') return; // embed externo: sem conta/ads
      try { sdkUser = await SDK().user.getUser(); } catch (e) { sdkUser = null; }
      try { SDK().user.addAuthListener((u) => { sdkUser = u; notify(); }); } catch (e) {}
    })();
    return ready;
  }

  // ---- OrbitAuth do portal (mesma interface consumida pelo game3d.js) -----
  window.OrbitAuth = {
    onChange(cb) { listeners.push(cb); load().then(notify).catch(() => cb(null)); },
    user: () => shim(),
    async getToken() {
      try { await load(); return await SDK().user.getUserToken(); }
      catch (e) { return null; }
    },
    // No portal, TODO login vira o prompt nativo do CrazyGames.
    async showAuthPrompt() {
      await load();
      try { await SDK().user.showAuthPrompt(); } catch (e) { /* cancelou/já logado */ }
      try { sdkUser = await SDK().user.getUser(); } catch (e) {}
      notify();
      return shim();
    },
    signInGoogle() { return this.showAuthPrompt(); },
    signInEmail() { return this.showAuthPrompt(); },
    signUpEmail() { return this.showAuthPrompt(); },
    signInGuest() { return this.showAuthPrompt(); },
    async signOut() { /* logout é feito no próprio portal (recarrega a página) */ },
    errKey: () => 'auth.err.generic',
  };

  // ---- OrbitAds: eventos + intersticial --------------------------------
  let lastAd = 0, inAd = false;
  const AD_COOLDOWN = 150000; // 2,5 min entre intersticiais (além do controle do SDK)
  // 'disabled' = embed fora do CrazyGames; em qualquer outro ambiente
  // (crazygames, local, QA Tool) o SDK decide — nós só tentamos.
  const canSDK = () => { const s = SDK(); return s && s.environment !== 'disabled'; };

  window.OrbitAds = {
    ready() { load().then(() => { try { SDK().game.loadingStop(); } catch (e) {} }).catch(() => {}); },
    gameplayStart() { if (canSDK()) { try { SDK().game.gameplayStart(); } catch (e) {} } },
    gameplayStop() { if (canSDK()) { try { SDK().game.gameplayStop(); } catch (e) {} } },
    midgame() {
      if (!canSDK() || inAd || Date.now() - lastAd < AD_COOLDOWN) return;
      inAd = true;
      const wasMuted = window.OrbitAudio ? OrbitAudio.isMuted() : true;
      const done = () => {
        inAd = false; lastAd = Date.now();
        if (window.OrbitAudio && !wasMuted) OrbitAudio.setMuted(false);
      };
      try {
        SDK().ad.requestAd('midgame', {
          adStarted: () => { if (window.OrbitAudio && !wasMuted) OrbitAudio.setMuted(true); },
          adFinished: done,
          adError: (e) => { console.warn('OrbitPool: midgame adError —', e && (e.code || e.message || e)); done(); },
        });
      } catch (e) { console.warn('OrbitPool: requestAd falhou —', e && e.message); done(); }
    },
  };

  // ---- Multiplayer do portal: convite + instant multiplayer -------------
  // Exigências do CrazyGames p/ jogos multiplayer: botão de convite (footer
  // do site) com o código da sala, auto-join via link e IsInstantMultiplayer.
  window.OrbitPortalGame = {
    async inviteParam(name) {
      try { await load(); return SDK().game.getInviteParam(name) || null; } catch (e) { return null; }
    },
    async instant() {
      try { await load(); return !!SDK().game.isInstantMultiplayer; } catch (e) { return false; }
    },
    showInvite(code) {
      load().then(() => { try { SDK().game.showInviteButton({ room: String(code) }); } catch (e) {} }).catch(() => {});
    },
    hideInvite() {
      load().then(() => { try { SDK().game.hideInviteButton(); } catch (e) {} }).catch(() => {});
    },
  };

  // Exigência do portal: bloquear o scroll da página no iframe.
  window.addEventListener('wheel', (e) => { if (e.target && e.target.id === 'c') e.preventDefault(); }, { passive: false });
  window.addEventListener('keydown', (e) => {
    if ([' ', 'ArrowUp', 'ArrowDown'].includes(e.key) && !/INPUT|TEXTAREA/.test((e.target && e.target.tagName) || '')) e.preventDefault();
  });

  load().catch(() => {});
})();
