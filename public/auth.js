/* =========================================================================
   OrbitPool — autenticação (Firebase Auth) para o modo ranqueado.
   API pura (a UI fica no menu/game3d.js):
     OrbitAuth.onChange(cb)        → cb(user|null) a cada mudança de sessão
     OrbitAuth.getToken()          → JWT se logado (sem UI), senão null
     OrbitAuth.signInGoogle()
     OrbitAuth.signInEmail(email, senha)
     OrbitAuth.signUpEmail(nome, email, senha)   → cria conta + displayName
     OrbitAuth.signInGuest(apelido)              → anônimo (ELO neste navegador)
     OrbitAuth.signOut()
     OrbitAuth.user()              → usuário atual (ou null)
     OrbitAuth.errKey(e)           → chave i18n amigável p/ erro do Firebase
   O SDK carrega sob demanda (ESM da CDN oficial) — site continua estático.
   As chaves de config são PÚBLICAS por design; a segurança vem da
   verificação do JWT no Worker.
   ========================================================================= */
'use strict';

window.OrbitAuth = (function () {
  const CFG = {
    apiKey: 'AIzaSyDi-0Iq3ovgIsxNGnl-qVXCIYywLoxdgCk',
    authDomain: 'orbitpool-49e20.firebaseapp.com',
    projectId: 'orbitpool-49e20',
    appId: '1:1019606091962:web:f616a69f8b7e3dcfea5a83',
    measurementId: 'G-H07E02GFYZ',
  };
  const CDN = 'https://www.gstatic.com/firebasejs/12.16.0/';
  const MEASUREMENT_ID = 'G-H07E02GFYZ';
  let A = null, auth = null, ready = null, app = null;
  const listeners = [];
  const notify = () => { const u = auth ? auth.currentUser : null; for (const cb of listeners) { try { cb(u); } catch (e) {} } };

  function load() {
    if (ready) return ready;
    ready = Promise.all([import(CDN + 'firebase-app.js'), import(CDN + 'firebase-auth.js')])
      .then(([appMod, authMod]) => {
        A = authMod;
        app = appMod.initializeApp(CFG);
        auth = A.getAuth(app);
        return new Promise((res) => {
          let first = true;
          A.onAuthStateChanged(auth, () => { notify(); if (first) { first = false; res(); } });
        });
      });
    return ready;
  }

  async function getToken() {
    try { await load(); } catch (e) { return null; }
    return auth.currentUser ? auth.currentUser.getIdToken() : null;
  }

  // Traduz códigos de erro do Firebase em chaves i18n.
  function errKey(e) {
    const c = (e && e.code) || '';
    if (/wrong-password|invalid-credential|user-not-found|invalid-login/.test(c)) return 'auth.err.invalid';
    if (/email-already-in-use/.test(c)) return 'auth.err.emailInUse';
    if (/weak-password/.test(c)) return 'auth.err.weakPass';
    if (/invalid-email|missing-email/.test(c)) return 'auth.err.badEmail';
    if (/too-many-requests/.test(c)) return 'auth.err.tooMany';
    if (/popup-closed|cancelled-popup|popup-blocked/.test(c)) return 'auth.err.popup';
    if (/network-request-failed/.test(c)) return 'auth.err.network';
    if (/operation-not-allowed/.test(c)) return 'auth.err.provider';
    return 'auth.err.generic';
  }

  // ---- Firebase Analytics COM CONSENTIMENTO (SÓ no site) -----------------
  // LGPD: o GA4 usa cookies, então só liga depois do "Aceitar todos". A
  // escolha fica em localStorage ('all' | 'essential'). Sem escolha ainda →
  // banner. Eventos do jogo entram por OrbitMetrics.log() e são descartados
  // se o jogador não consentiu.
  const CONSENT_KEY = 'orbitpool.consent';
  let analytics = null, logEventFn = null;
  const pending = [];
  window.OrbitMetrics = {
    log(name, params) {
      if (logEventFn && analytics) { try { logEventFn(analytics, name, params || {}); } catch (e) {} }
      else if (pending.length < 20) pending.push([name, params]);
    },
  };

  function startAnalytics() {
    load().then(() => import(CDN + 'firebase-analytics.js')).then(async (an) => {
      if (!(await an.isSupported().catch(() => false))) return;
      analytics = an.getAnalytics(app);
      logEventFn = an.logEvent;
      for (const [n, p2] of pending.splice(0)) window.OrbitMetrics.log(n, p2);
    }).catch(() => {});
  }

  function consentBanner() {
    const T = (k, fb) => (window.OrbitI18N ? OrbitI18N.t(k) : fb) || fb;
    const bar = document.createElement('div');
    bar.id = 'cookieBar';
    bar.style.cssText = 'position:fixed;left:0;right:0;bottom:0;z-index:80;display:flex;flex-wrap:wrap;' +
      'gap:10px;align-items:center;justify-content:center;padding:12px 16px calc(12px + env(safe-area-inset-bottom));' +
      'background:rgba(10,14,12,.96);border-top:1px solid rgba(255,210,74,.35);' +
      'font:14px/1.45 system-ui,-apple-system,"Segoe UI",sans-serif;color:#e8e2d2;';
    const txt = document.createElement('span');
    txt.style.cssText = 'max-width:560px;';
    txt.innerHTML = T('ck.msg', 'Usamos cookies de análise para entender como o jogo é usado.') +
      ' <a href="/privacidade.html" style="color:#8fe3ff;">' + T('ck.more', 'Saiba mais') + '</a>';
    const mk = (label, primary) => {
      const b = document.createElement('button');
      b.textContent = label;
      b.style.cssText = 'padding:9px 16px;border-radius:999px;cursor:pointer;font-weight:600;font-size:13px;' +
        (primary
          ? 'border:none;background:linear-gradient(180deg,#ffd24a,#e69a1a);color:#3a1e05;'
          : 'border:1px solid rgba(255,255,255,.3);background:transparent;color:#e8d9b5;');
      return b;
    };
    const all = mk(T('ck.all', 'Aceitar todos'), true);
    const ess = mk(T('ck.essential', 'Só essenciais'), false);
    const done = (choice) => {
      try { localStorage.setItem(CONSENT_KEY, choice); } catch (e) {}
      bar.remove();
      if (choice === 'all') startAnalytics();
    };
    all.addEventListener('click', () => done('all'));
    ess.addEventListener('click', () => done('essential'));
    bar.appendChild(txt); bar.appendChild(ess); bar.appendChild(all);
    document.body.appendChild(bar);
  }

  (function initConsent() {
    let choice = null;
    try { choice = localStorage.getItem(CONSENT_KEY); } catch (e) {}
    if (choice === 'all') startAnalytics();
    else if (choice !== 'essential') {
      if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', consentBanner);
      else consentBanner();
    }
  })();

  return {
    onChange(cb) { listeners.push(cb); load().catch(() => cb(null)); },
    getToken,
    errKey,
    user: () => (auth ? auth.currentUser : null),

    async signInGoogle() {
      await load();
      await A.signInWithPopup(auth, new A.GoogleAuthProvider());
      notify();
      return auth.currentUser;
    },
    async signInEmail(email, senha) {
      await load();
      await A.signInWithEmailAndPassword(auth, String(email).trim(), senha);
      notify();
      return auth.currentUser;
    },
    async signUpEmail(nome, email, senha) {
      await load();
      await A.createUserWithEmailAndPassword(auth, String(email).trim(), senha);
      const nm = String(nome || '').trim().slice(0, 20);
      if (nm) { try { await A.updateProfile(auth.currentUser, { displayName: nm }); } catch (e) {} }
      try { await auth.currentUser.getIdToken(true); } catch (e) {} // token já com o nome
      notify();
      return auth.currentUser;
    },
    async signInGuest(apelido) {
      await load();
      if (!auth.currentUser) await A.signInAnonymously(auth);
      const nm = String(apelido || '').trim().slice(0, 20);
      if (nm && auth.currentUser.displayName !== nm) {
        try { await A.updateProfile(auth.currentUser, { displayName: nm }); await auth.currentUser.getIdToken(true); } catch (e) {}
      }
      notify();
      return auth.currentUser;
    },
    async signOut() {
      await load();
      await A.signOut(auth);
      notify();
    },
  };
})();
