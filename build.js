/* =========================================================================
   OrbitPool — build de produção (dist/).
   Uso:  npm run build          → gera dist/ pronto para deploy (Pages/qualquer)
         npm start              → build + serve dist/ localmente
   Etapas:
     1. Limpa dist/ e copia todos os assets de public/ (música, env, glb...).
     2. JS do jogo: Terser (minify + mangle local, remove console.log) e
        obfuscação LEVE (string array; sem control-flow flattening — a física
        e o bot rodam a 60fps e não podem pagar esse custo).
     3. Libs vendorizadas e i18n: só minify (não são segredo de ninguém).
     4. index.html: minify de HTML + CSS + JS inline.
     5. sw.js: injeta VERSION = hash do conteúdo dos arquivos do shell —
        todo build muda a versão do cache automaticamente (ninguém mais
        precisa lembrar de "subir o v3 pra v4").
     6. Gera _headers (Cloudflare Pages) com os security headers/CSP.
   IMPORTANTE: os NOMES dos arquivos não mudam — index.html e o service
   worker referenciam por nome; mangle nunca toca em globais (os <script>
   compartilham OrbitNet, OrbitI18N, startApp etc. entre arquivos).
   ========================================================================= */
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { minify: terser } = require('terser');
const { minify: htmlMinify } = require('html-minifier-terser');
const JavaScriptObfuscator = require('javascript-obfuscator');

const SRC = path.join(__dirname, 'public');
const OUT = path.join(__dirname, 'dist');

// JS com lógica própria do jogo → minify + obfuscação leve
const OBFUSCATE = ['rules.js', 'physics.js', 'game3d.js', 'bot.js', 'net.js', 'ranked.js', 'auth.js', 'audio.js', 'menu.js'];
// Libs de terceiros / traduções / SW → só minify
const MINIFY_ONLY = ['GLTFLoader.js', 'OBJLoader.js', 'i18n.js', 'table3d_collider.js', 'sw.js'];

const TERSER_OPTS = {
  compress: {
    passes: 2,
    // remove logs de debug; MANTÉM warn/error (diagnóstico em produção)
    pure_funcs: ['console.log', 'console.debug', 'console.info'],
  },
  mangle: true, // só escopo local — top-level/globais ficam intactos
  format: { comments: false },
};

// Obfuscação leve: esconde strings/estrutura sem custo de runtime relevante.
// NUNCA ligar aqui: controlFlowFlattening, deadCodeInjection, selfDefending
// (todos degradam a física/bot ou quebram em navegador com formatação).
const OBF_OPTS = {
  compact: true,
  renameGlobals: false, // <script>s separados compartilham globais
  stringArray: true,
  stringArrayThreshold: 0.75,
  stringArrayEncoding: ['base64'],
  stringArrayRotate: true,
  stringArrayShuffle: true,
  stringArrayWrappersCount: 1,
  identifierNamesGenerator: 'hexadecimal',
  numbersToExpressions: false, // física: números literais ficam como estão
  simplify: true,
  target: 'browser',
};

// Cópia manual (mkdir + copyFile): fs.cpSync tenta preservar permissões e
// falha em alguns filesystems (drives montados, containers).
function copyTree(src, dst) {
  fs.mkdirSync(dst, { recursive: true });
  for (const e of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, e.name), d = path.join(dst, e.name);
    if (e.isDirectory()) copyTree(s, d);
    else fs.copyFileSync(s, d);
  }
}

async function buildJs(file, obfuscate) {
  const code = fs.readFileSync(file, 'utf8');
  const min = await terser(code, TERSER_OPTS);
  if (min.error) throw min.error;
  let out = min.code || '';
  if (obfuscate && out.trim()) {
    out = JavaScriptObfuscator.obfuscate(out, OBF_OPTS).getObfuscatedCode();
  }
  return out;
}

async function main() {
  const t0 = Date.now();
  fs.rmSync(OUT, { recursive: true, force: true });

  // 1) copia tudo (assets); JS/HTML serão sobrescritos pelas versões buildadas
  copyTree(SRC, OUT);

  // 2) JS
  const report = [];
  for (const name of [...OBFUSCATE, ...MINIFY_ONLY]) {
    const src = path.join(SRC, name);
    if (!fs.existsSync(src)) { console.warn('  (aviso) não achei', name); continue; }
    const out = await buildJs(src, OBFUSCATE.includes(name));
    fs.writeFileSync(path.join(OUT, name), out);
    report.push([name, fs.statSync(src).size, Buffer.byteLength(out)]);
  }

  // 3) index.html (CSS e JS inline minificados junto)
  const htmlSrc = fs.readFileSync(path.join(SRC, 'index.html'), 'utf8');
  const html = await htmlMinify(htmlSrc, {
    collapseWhitespace: true,
    removeComments: true,
    minifyCSS: true,
    minifyJS: TERSER_OPTS,
    keepClosingSlash: true,
  });
  fs.writeFileSync(path.join(OUT, 'index.html'), html);
  report.push(['index.html', Buffer.byteLength(htmlSrc), Buffer.byteLength(html)]);

  // 4) sw.js: VERSION = hash do shell buildado (cache busting automático)
  const swPath = path.join(OUT, 'sw.js');
  let sw = fs.readFileSync(swPath, 'utf8');
  const shellFiles = ['index.html', 'rules.js', 'physics.js', 'game3d.js', 'bot.js', 'net.js', 'ranked.js', 'auth.js',
    'audio.js', 'menu.js', 'i18n.js', 'table3d_collider.js', 'GLTFLoader.js', 'OBJLoader.js'];
  const h = crypto.createHash('sha256');
  for (const f of shellFiles) { const p = path.join(OUT, f); if (fs.existsSync(p)) h.update(fs.readFileSync(p)); }
  const version = 'orbitpool-' + h.digest('hex').slice(0, 10);
  const swOut = sw.replace(/(["'])orbitpool-v?[\w-]*\1/, JSON.stringify(version));
  if (swOut === sw) console.warn('  (aviso) não achei a VERSION no sw.js — cache pode não atualizar');
  fs.writeFileSync(swPath, swOut);
  console.log('  service worker →', version);

  // 5) _headers (Cloudflare Pages) — security headers + CSP
  fs.writeFileSync(path.join(OUT, '_headers'), `/*
  X-Content-Type-Options: nosniff
  X-Frame-Options: DENY
  Referrer-Policy: strict-origin-when-cross-origin
  Permissions-Policy: camera=(), microphone=(), geolocation=(), payment=()
  Cross-Origin-Opener-Policy: same-origin-allow-popups
  Content-Security-Policy: default-src 'self'; script-src 'self' 'unsafe-inline' https://cdnjs.cloudflare.com https://cdn.jsdelivr.net https://unpkg.com https://www.gstatic.com; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data: blob:; media-src 'self' blob:; connect-src 'self' blob: data: wss: https:; worker-src 'self' blob:; object-src 'none'; base-uri 'self'; frame-ancestors 'none'; upgrade-insecure-requests
`);

  // 6) relatório
  console.log('\n  arquivo               antes   →  depois');
  let a = 0, b = 0;
  for (const [n, s0, s1] of report) {
    a += s0; b += s1;
    console.log('  ' + n.padEnd(20) + String((s0 / 1024).toFixed(1) + 'K').padStart(8)
      + '  → ' + String((s1 / 1024).toFixed(1) + 'K').padStart(8));
  }
  console.log('  ' + 'TOTAL (código)'.padEnd(20) + String((a / 1024).toFixed(1) + 'K').padStart(8)
    + '  → ' + String((b / 1024).toFixed(1) + 'K').padStart(8));
  console.log(`\n✅ dist/ pronto em ${((Date.now() - t0) / 1000).toFixed(1)}s\n`);
}

main().catch((e) => { console.error('❌ build falhou:', e); process.exit(1); });
