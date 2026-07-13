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
// DER helpers: converte chave PKCS#1 ("BEGIN RSA PUBLIC KEY", usada pelo
// CrazyGames) para SPKI, que é o único formato que o WebCrypto importa.
function derLen(n) {
  if (n < 0x80) return Uint8Array.of(n);
  const b = []; while (n > 0) { b.unshift(n & 0xff); n >>= 8; }
  return Uint8Array.from([0x80 | b.length, ...b]);
}
function derWrap(tag, body) {
  const l = derLen(body.length);
  const out = new Uint8Array(1 + l.length + body.length);
  out[0] = tag; out.set(l, 1); out.set(body, 1 + l.length);
  return out;
}
function pkcs1ToSpki(pkcs1) {
  // AlgorithmIdentifier { rsaEncryption (1.2.840.113549.1.1.1), NULL }
  const algId = Uint8Array.from([0x30, 0x0d, 0x06, 0x09, 0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01, 0x01, 0x01, 0x05, 0x00]);
  const bits = derWrap(0x03, Uint8Array.from([0x00, ...pkcs1])); // BIT STRING (0 bits sobrando)
  const seq = new Uint8Array(algId.length + bits.length);
  seq.set(algId, 0); seq.set(bits, algId.length);
  return derWrap(0x30, seq);
}
async function importSpkiPem(pem) {
  const isPkcs1 = /BEGIN RSA PUBLIC KEY/.test(pem);
  let der = b64uToBytes(pem.replace(/-----[^-]+-----/g, '').replace(/\s+/g, '')
    .replace(/\+/g, '-').replace(/\//g, '_')); // normaliza p/ b64url e decodifica
  if (isPkcs1) der = pkcs1ToSpki(der);
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
