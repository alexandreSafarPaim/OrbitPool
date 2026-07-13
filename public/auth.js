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
  };
  const CDN = 'https://www.gstatic.com/firebasejs/12.16.0/';
  let A = null, auth = null, ready = null;
  const listeners = [];
  const notify = () => { const u = auth ? auth.currentUser : null; for (const cb of listeners) { try { cb(u); } catch (e) {} } };

  function load() {
    if (ready) return ready;
    ready = Promise.all([import(CDN + 'firebase-app.js'), import(CDN + 'firebase-auth.js')])
      .then(([appMod, authMod]) => {
        A = authMod;
        auth = A.getAuth(appMod.initializeApp(CFG));
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
    return 'auth.err.generic';
  }

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
