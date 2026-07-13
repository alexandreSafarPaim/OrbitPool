/* =========================================================================
   Gera src/engine.mjs a partir de ../public/physics.js + ../public/rules.js.
   O servidor ranqueado roda EXATAMENTE o mesmo motor do cliente — nunca
   edite engine.mjs à mão; rode `npm run gen` após mudar física/regras.
   ========================================================================= */
'use strict';
const fs = require('fs');
const path = require('path');

const pub = (f) => fs.readFileSync(path.join(__dirname, '..', 'public', f), 'utf8');
const physics = pub('physics.js');
const rules = pub('rules.js');

const out = [
  '// ARQUIVO AUTO-GERADO por gen-engine.js — NÃO EDITAR.',
  '// Fonte: public/physics.js + public/rules.js. Rode `npm run gen` para atualizar.',
  physics,
  rules,
  'export { Physics, W, H, RAIL, R, POCKET, MOUTH, MAX_SHOT, STOP_SPEED, POCKETS };',
  'export const Rules = OrbitRules;',
  '',
].join('\n');

fs.mkdirSync(path.join(__dirname, 'src'), { recursive: true });
fs.writeFileSync(path.join(__dirname, 'src', 'engine.mjs'), out);
console.log('src/engine.mjs gerado (' + (out.length / 1024).toFixed(1) + 'K)');
