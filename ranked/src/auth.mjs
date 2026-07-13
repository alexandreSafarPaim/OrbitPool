/* =========================================================================
   Autenticação multi-emissor. Retorna identidade { id, name } ou null.
     • Firebase (site próprio):   id = "fb:<uid>"   — JWT RS256 (JWKS Google)
     • CrazyGames (portal):       id = "cg:<uid>"   — JWT RS256 (chave pública)
     • Dev (só testes locais):    id = "dev:<x>"    — exige ALLOW_DEV_AUTH=true
   O Worker verifica o token e repassa a identidade ao Durable Object por
   header interno (o DO nunca é alcançável sem passar pelo Worker).
   ========================================================================= */
'use strict';

const b64uToBytes = (s) => {
  s = s.replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(s + '='.repeat((4 - (s.length % 4)) % 4));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
};
const b64uToJSON = (s) => JSON.parse(new TextDecoder().decode(b64uToBytes(s)));

// Cache simples de chaves (por isolate) — evita rebuscar JWKS a cada conexão.
const keyCache = new Map(); // url|kid → { key, exp }
const CACHE_MS = 6 * 3600 * 1000;

async function importJwk(jwk) {
  return crypto.subtle.importKey('jwk', jwk, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
}
async function importSpkiPem(pem) {
  const der = b64uToBytes(pem.replace(/-----[^-]+-----/g, '').replace(/\s+/g, '')
    .replace(/\+/g, '-').replace(/\//g, '_')); // normaliza p/ b64url e decodifica
  return crypto.subtle.importKey('spki', der, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
}

async function verifyRS256(token, getKey) {
  const [h, p, sig] = token.split('.');
  if (!h || !p || !sig) return null;
  const header = b64uToJSON(h);
  const key = await getKey(header);
  if (!key) return null;
  const ok = await crypto.subtle.verify(
    'RSASSA-PKCS1-v1_5', key, b64uToBytes(sig), new TextEncoder().encode(h + '.' + p)
  );
  if (!ok) return null;
  const payload = b64uToJSON(p);
  if (payload.exp && payload.exp * 1000 < Date.now()) return null;
  return payload;
}

async function firebaseKey(header) {
  const url = 'https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com';
  const ck = url + '|' + header.kid;
  const hit = keyCache.get(ck);
  if (hit && hit.exp > Date.now()) return hit.key;
  const jwks = await (await fetch(url)).json();
  const jwk = (jwks.keys || []).find((k) => k.kid === header.kid);
  if (!jwk) return null;
  const key = await importJwk(jwk);
  keyCache.set(ck, { key, exp: Date.now() + CACHE_MS });
  return key;
}

async function crazygamesKey() {
  const url = 'https://sdk.crazygames.com/publicKey.json';
  const hit = keyCache.get(url);
  if (hit && hit.exp > Date.now()) return hit.key;
  const body = await (await fetch(url)).json();
  const key = await importSpkiPem(body.publicKey || body.key || '');
  keyCache.set(url, { key, exp: Date.now() + CACHE_MS });
  return key;
}

export async function verifyToken(token, env) {
  if (!token) return null;
  try {
    // Dev (testes locais — NUNCA habilitar em produção)
    if (token.startsWith('dev.')) {
      if (env.ALLOW_DEV_AUTH !== 'true') return null;
      const u = b64uToJSON(token.slice(4));
      if (!u.id) return null;
      return { id: 'dev:' + String(u.id).slice(0, 64), name: String(u.name || u.id).slice(0, 24) };
    }
    const payload = b64uToJSON(token.split('.')[1] || '');
    // Firebase
    if (payload.iss && payload.iss.startsWith('https://securetoken.google.com/')) {
      if (!env.FIREBASE_PROJECT_ID) return null;
      const v = await verifyRS256(token, firebaseKey);
      if (!v) return null;
      if (v.aud !== env.FIREBASE_PROJECT_ID) return null;
      if (v.iss !== 'https://securetoken.google.com/' + env.FIREBASE_PROJECT_ID) return null;
      const name = v.name || (v.email ? v.email.split('@')[0] : 'Jogador');
      return { id: 'fb:' + v.sub, name: String(name).slice(0, 24) };
    }
    // CrazyGames
    if (payload.userId) {
      const v = await verifyRS256(token, crazygamesKey);
      if (!v || !v.userId) return null;
      return { id: 'cg:' + v.userId, name: String(v.username || 'Jogador').slice(0, 24) };
    }
  } catch (e) { /* token malformado */ }
  return null;
}
