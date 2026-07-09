/* =========================================================================
   Bilhar 3D — cliente Three.js sobre o MESMO motor de física (physics.js) e o
   MESMO protocolo de rede do jogo 2D (join/shot/aim/rematch). A física roda no
   plano (x∈[0,W], y∈[0,H]); aqui só renderizamos em 3D e mapeamos as posições.
   Mapeamento: mundo3D = (px - W/2, altura, py - H/2), com o feltro em Y=0.
   ========================================================================= */
'use strict';

// ---- Cores das bolas (iguais ao 2D) ---------------------------------------
const SOLID = { 1: '#f4c430', 2: '#1f5fd0', 3: '#d0322b', 4: '#6a2fa0', 5: '#e07b18', 6: '#1a8f4a', 7: '#7a1f1f' };
const colorFor = (n) => (n === 8 ? '#161616' : (n <= 7 ? SOLID[n] : SOLID[n - 8]));
const isStripe = (n) => n >= 9 && n <= 15;
function groupName(n) { if (n === 8) return 'eight'; if (n >= 1 && n <= 7) return 'solid'; if (n >= 9 && n <= 15) return 'stripe'; return null; }
const RACK_NUMBERS = [1, 9, 2, 10, 8, 3, 11, 7, 14, 4, 5, 13, 15, 6, 12];
const MAXDRAG_PX = 190;   // arraste (px de tela) para potência máxima

// ===========================================================================
// Estado de jogo (espelha o 2D)
// ===========================================================================
let balls = [];
let myNo = 0, oppName = 'Adversário', myName = 'Você';
let currentTurn = 1;
let phase = 'lobby';            // lobby | aim | sim | wait | ended
let ballInHand = false;
let ws = null, roomInput = 'sala1';
let currentShot = null, shotElapsed = 0, shotQueue = [], soundCursor = 0;
let cueOffset = { a: 0, b: 0 };

const game = { open: true, groups: { 1: null, 2: null }, gameOver: false, winner: 0, lastMsg: '' };

// Série melhor-de-5 (primeiro a 3 vitórias vence o match). Placar sincronizado
// sem rede extra: os dois lados calculam o vencedor de cada partida de forma
// idêntica (mesma timeline determinística), então incrementam igual.
const SERIES_GAMES = 5, SERIES_TARGET = 3;
let matchScore = { 1: 0, 2: 0 }, matchOver = false;

// ===========================================================================
// Three.js — cena
// ===========================================================================
const canvas = document.getElementById('c');
let renderer = null;

// Cria o renderer WebGL com tolerância a falha (Chrome sem aceleração de
// hardware lança "Error creating WebGL context"). Retorna true se deu certo.
function initRenderer() {
  const opts = [
    { canvas, antialias: true },
    { canvas, antialias: false, powerPreference: 'low-power', failIfMajorPerformanceCaveat: false },
  ];
  for (const o of opts) {
    try { renderer = new THREE.WebGLRenderer(o); } catch (e) { renderer = null; }
    if (renderer) break;
  }
  if (!renderer) { showWebGLError(); return false; }
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  if (THREE.sRGBEncoding) renderer.outputEncoding = THREE.sRGBEncoding;
  return true;
}
function showWebGLError() {
  const m = document.getElementById('lobbyMsg');
  if (m) {
    m.innerHTML = 'Este navegador está sem <b>WebGL</b> (aceleração de hardware desativada). Ative-a no Chrome e reinicie.';
    const wrap = document.createElement('div');
    wrap.style.cssText = 'margin-top:12px;display:flex;flex-direction:column;gap:8px';

    const copyBtn = document.createElement('button');
    copyBtn.textContent = '📋 Copiar link das configurações';
    copyBtn.style.margin = '0';
    copyBtn.onclick = () => {
      const url = 'chrome://settings/system';
      const done = () => { copyBtn.textContent = '✓ Copiado! Cole na barra de endereços e Enter'; };
      const manual = () => { copyBtn.textContent = url + '  (copie manualmente)'; };
      if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(url).then(done).catch(manual);
      else manual();
    };

    const tip = document.createElement('div');
    tip.className = 'hint';
    tip.innerHTML = 'Cole na barra de endereços, ligue <b>"Usar aceleração de hardware quando disponível"</b> e reinicie o Chrome. Confira em <b>chrome://gpu</b>. (O Chrome não deixa esta página abrir <i>chrome://</i> direto — por isso o botão copia o endereço.)';

    wrap.appendChild(copyBtn); wrap.appendChild(tip);
    m.parentNode.appendChild(wrap);
  }
  ['joinBtn', 'createBtn'].forEach((id) => {
    const b = document.getElementById(id);
    if (b) { b.disabled = true; b.style.opacity = 0.5; }
  });
  const cb = document.getElementById('createBtn');
  if (cb) cb.textContent = 'WebGL indisponível';
}

const scene = new THREE.Scene();
scene.background = new THREE.Color('#0a0e14');
const camera = new THREE.PerspectiveCamera(55, 1, 10, 20000);

// Luzes
scene.add(new THREE.HemisphereLight(0xffffff, 0x2a3540, 0.75));
const keyLight = new THREE.DirectionalLight(0xffffff, 0.9);
keyLight.position.set(-250, 700, 200);
keyLight.castShadow = true;
keyLight.shadow.mapSize.set(1024, 1024);
keyLight.shadow.camera.left = -700; keyLight.shadow.camera.right = 700;
keyLight.shadow.camera.top = 500; keyLight.shadow.camera.bottom = -500;
keyLight.shadow.camera.near = 100; keyLight.shadow.camera.far = 1600;
scene.add(keyLight);
const fill = new THREE.DirectionalLight(0xbcd2e8, 0.35); fill.position.set(300, 400, -300); scene.add(fill);

// Helpers de conversão física → mundo
const to3 = (px, py, y) => new THREE.Vector3(px - W / 2, y == null ? R : y, py - H / 2);

// ---- Mesa -----------------------------------------------------------------
const tableGroup = new THREE.Group();
scene.add(tableGroup);
const RAIL_W = 30, RAIL_H = 26, WOOD = 60;

function buildTable() {
  buildProceduralTable();  // mesa desenhada por código (fallback imediato)
  tryLoadModel();          // tenta trocar pelo modelo 3D externo
}

// Carrega o modelo OBJ (assets → public/pooltable.obj) e o alinha à física:
// as caçapas do modelo (X±71, Z±35.5) mapeiam na área de jogo (±450, ±225),
// e o feltro (Y≈32.4) vai para y=0. Se falhar, mantém a mesa procedural.
function tryLoadModel() {
  if (!window.THREE || !THREE.OBJLoader) return;
  let loader;
  try { loader = new THREE.OBJLoader(); } catch (e) { return; }
  loader.load('pooltable.obj', (obj) => {
    const tex = new THREE.TextureLoader().load('pooltable_tex.png');
    if (THREE.sRGBEncoding) tex.encoding = THREE.sRGBEncoding;
    obj.traverse((c) => {
      if (c.isMesh) {
        c.material = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.85, metalness: 0.1 });
        c.castShadow = true; c.receiveShadow = true;
      }
    });
    // Escala NÃO-uniforme: o nariz das almofadas do modelo (X±69.9, Z±33.8)
    // cai exatamente onde a BORDA da bola para (world ±W/2 × ±H/2 = ±450×±225),
    // então a bola encosta na parede visível sem atravessar.
    const SX = (W / 2) / 69.9, SZ = (H / 2) / 33.8, SY = SX;
    obj.scale.set(SX, SY, SZ);
    obj.position.set(0, -32.4 * SY, 0);  // feltro (Y≈32.4) para y=0
    while (tableGroup.children.length) tableGroup.remove(tableGroup.children[0]);
    tableGroup.add(obj);
  }, undefined, (e) => { console.warn('Modelo 3D não carregou; mantendo mesa procedural.', e); });
}

function buildProceduralTable() {
  // Feltro
  const feltMat = new THREE.MeshStandardMaterial({ color: 0x13934e, roughness: 0.95, metalness: 0 });
  const felt = new THREE.Mesh(new THREE.PlaneGeometry(W, H), feltMat);
  felt.rotation.x = -Math.PI / 2; felt.position.set(0, 0, 0); felt.receiveShadow = true;
  feltMat.polygonOffset = true; feltMat.polygonOffsetFactor = 1; feltMat.polygonOffsetUnits = 1;
  tableGroup.add(felt);

  // Base de madeira (moldura) — caixa maior sob o feltro (topo bem abaixo do
  // feltro para NÃO haver z-fighting/piscar entre as duas superfícies).
  const woodMat = new THREE.MeshStandardMaterial({ color: 0x6b3f22, roughness: 0.6, metalness: 0.05 });
  const base = new THREE.Mesh(new THREE.BoxGeometry(W + 2 * (RAIL_W + WOOD), 40, H + 2 * (RAIL_W + WOOD)), woodMat);
  base.position.set(0, -24, 0); base.receiveShadow = true; tableGroup.add(base);
  // Borda superior de madeira (quadro em volta)
  const frameMat = new THREE.MeshStandardMaterial({ color: 0x7d4f28, roughness: 0.5, metalness: 0.08 });
  const frameH = 30;
  const mkFrame = (w, d, x, z) => { const m = new THREE.Mesh(new THREE.BoxGeometry(w, frameH, d), frameMat); m.position.set(x, frameH / 2 - 2, z); m.castShadow = true; m.receiveShadow = true; tableGroup.add(m); };
  const outW = W + 2 * (RAIL_W + WOOD), outH = H + 2 * (RAIL_W + WOOD);
  mkFrame(outW, WOOD, 0, -(H / 2 + RAIL_W + WOOD / 2));
  mkFrame(outW, WOOD, 0, (H / 2 + RAIL_W + WOOD / 2));
  mkFrame(WOOD, outH, -(W / 2 + RAIL_W + WOOD / 2), 0);
  mkFrame(WOOD, outH, (W / 2 + RAIL_W + WOOD / 2), 0);

  // Almofadas (cushions): UMA peça contínua por mesa, extrudando o contorno
  // interno do feltro (rails + chanfros, com as bocas das caçapas abertas).
  // A face interna segue exatamente a linha onde a bola bate (nose = contato−R).
  const cushMat = new THREE.MeshStandardMaterial({ color: 0x0a5230, roughness: 0.85, metalness: 0 });
  const railsT = Physics.TABLE.rails, chamfersT = Physics.TABLE.walls.slice(railsT.length);
  const noseOf = (px, py, nx, ny) => ({ x: px - nx * R, y: py - ny * R });
  const chamAt = (px, py) => chamfersT.find((c) => Math.abs(c.ax - px) < 0.5 && Math.abs(c.ay - py) < 0.5);
  const farNose = (c) => noseOf(c.bx, c.by, c.nx, c.ny);
  const railSeq = (r, fwd) => {
    const aP = noseOf(r.ax, r.ay, r.nx, r.ny), bP = noseOf(r.bx, r.by, r.nx, r.ny);
    const cA = chamAt(r.ax, r.ay), cB = chamAt(r.bx, r.by);
    const fA = cA ? farNose(cA) : aP, fB = cB ? farNose(cB) : bP;
    return fwd ? [fA, aP, bP, fB] : [fB, bP, aP, fA];
  };
  // UMA peça de almofada por rail: face interna = nariz do rail + as gargantas
  // dos chanfros (pontas chanfradas); face externa = offset RAIL_W para fora.
  // Assim as bocas das caçapas ficam ABERTAS (a almofada não cobre o buraco).
  const sp = (p) => [p.x - W / 2, H / 2 - p.y];
  const off = (p, nx, ny) => ({ x: p.x - nx * RAIL_W, y: p.y - ny * RAIL_W });
  for (const rail of railsT) {
    const A = noseOf(rail.ax, rail.ay, rail.nx, rail.ny), B = noseOf(rail.bx, rail.by, rail.nx, rail.ny);
    const cA = chamAt(rail.ax, rail.ay), cB = chamAt(rail.bx, rail.by);
    const tA = cA ? farNose(cA) : A, tB = cB ? farNose(cB) : B;
    const nA = cA || rail, nB = cB || rail;
    const inner = [tA, A, B, tB];
    const outer = [off(tB, nB.nx, nB.ny), off(B, rail.nx, rail.ny), off(A, rail.nx, rail.ny), off(tA, nA.nx, nA.ny)];
    const pts = inner.concat(outer);
    const shape = new THREE.Shape();
    const s0 = sp(pts[0]); shape.moveTo(s0[0], s0[1]);
    for (let i = 1; i < pts.length; i++) { const q = sp(pts[i]); shape.lineTo(q[0], q[1]); }
    shape.closePath();
    const geo = new THREE.ExtrudeGeometry(shape, { depth: RAIL_H, bevelEnabled: false });
    const mesh = new THREE.Mesh(geo, cushMat);
    mesh.rotation.x = -Math.PI / 2; mesh.position.y = 0;
    mesh.castShadow = true; mesh.receiveShadow = true;
    tableGroup.add(mesh);
  }

  // Caçapas: buraco preto (disco) + aro metálico. Menores, do tamanho da boca.
  for (const p of Physics.TABLE.pockets) {
    const hr = p.cap + 5; // buraco um pouco maior que o raio de captura
    const disc = new THREE.Mesh(new THREE.CircleGeometry(hr, 28), new THREE.MeshBasicMaterial({ color: 0x050505 }));
    disc.rotation.x = -Math.PI / 2; disc.position.set(p.x - W / 2, 2.5, p.y - H / 2);
    tableGroup.add(disc);
    const rim = new THREE.Mesh(new THREE.RingGeometry(hr, hr + 5, 28), new THREE.MeshStandardMaterial({ color: 0x9a9aa2, roughness: 0.4, metalness: 0.6, side: THREE.DoubleSide }));
    rim.rotation.x = -Math.PI / 2; rim.position.set(p.x - W / 2, 3, p.y - H / 2);
    tableGroup.add(rim);
  }
}

// ---- Textura de bola (equirretangular: equador no meio) --------------------
function ballTexture(n) {
  const cv = document.createElement('canvas'); cv.width = 256; cv.height = 128;
  const g = cv.getContext('2d');
  const stripe = isStripe(n);
  if (n === 0) { g.fillStyle = '#f3f3ec'; g.fillRect(0, 0, 256, 128); }
  else if (stripe) { g.fillStyle = '#f3f3ec'; g.fillRect(0, 0, 256, 128); g.fillStyle = colorFor(n); g.fillRect(0, 38, 256, 52); }
  else { g.fillStyle = colorFor(n); g.fillRect(0, 0, 256, 128); }
  if (n === 0) {
    g.fillStyle = '#d23b3b';
    for (const u of [64, 192]) { g.beginPath(); g.arc(u, 64, 9, 0, 7); g.fill(); }
  } else {
    for (const u of [64, 192]) {
      g.beginPath(); g.arc(u, 64, 25, 0, 7); g.fillStyle = '#fff'; g.fill();
      g.fillStyle = '#111'; g.font = 'bold 30px system-ui, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
      g.fillText(String(n), u, 66);
    }
  }
  const tex = new THREE.CanvasTexture(cv);
  tex.anisotropy = 4; tex.needsUpdate = true;
  return tex;
}

const ballMeshes = {}; // n -> mesh
function buildBalls() {
  for (const n of [0, ...RACK_NUMBERS]) {
    const mat = new THREE.MeshStandardMaterial({ map: ballTexture(n), roughness: 0.28, metalness: 0.05 });
    const mesh = new THREE.Mesh(new THREE.SphereGeometry(R, 40, 28), mat);
    mesh.castShadow = true;
    mesh.userData.shiny = true; // reflete mais o ambiente (bar) que o feltro/madeira
    scene.add(mesh);
    ballMeshes[n] = mesh;
  }
}

// ---- Mira: linha + taco ----------------------------------------------------
let aimLine, cueStick, ghostBall;
function buildAimHelpers() {
  const lg = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]);
  aimLine = new THREE.Line(lg, new THREE.LineDashedMaterial({ color: 0xffffff, dashSize: 14, gapSize: 10, transparent: true, opacity: 0.7 }));
  aimLine.visible = false; scene.add(aimLine);
  cueStick = new THREE.Mesh(new THREE.CylinderGeometry(3.2, 5.5, 520, 16),
    new THREE.MeshStandardMaterial({ color: 0xc9a227, roughness: 0.5 }));
  cueStick.visible = false; scene.add(cueStick);
  ghostBall = new THREE.Mesh(new THREE.SphereGeometry(R * 1.01, 20, 16),
    new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.25 }));
  ghostBall.visible = false; scene.add(ghostBall);
}

// ===========================================================================
// Bolas: criação lógica (posições físicas) — igual ao 2D
// ===========================================================================
function makeBalls() {
  balls = [];
  const jitter = () => (Math.random() - 0.5) * 0.4;
  balls.push({ n: 0, x: W * 0.25, y: H / 2, vx: 0, vy: 0, wx: 0, wy: 0, wz: 0, potted: false });
  const rackX = W * 0.70, rackY = H / 2, gap = 2 * R + 0.4; let idx = 0;
  for (let row = 0; row < 5; row++) for (let i = 0; i <= row; i++) {
    const n = RACK_NUMBERS[idx++];
    balls.push({ n, x: rackX + row * gap * 0.8660254 + jitter(), y: rackY + (i - row / 2) * gap + jitter(), vx: 0, vy: 0, wx: 0, wy: 0, wz: 0, potted: false });
  }
  for (const b of balls) { b._px = b.x; b._py = b.y; }
}
const ballByN = (n) => balls.find((b) => b.n === n);
const cue = () => ballByN(0);

function syncMeshes() {
  for (const b of balls) {
    const m = ballMeshes[b.n];
    if (!m) continue;
    if (b.potted) { m.visible = false; continue; }
    m.visible = true;
    // rolagem: gira em torno do eixo horizontal ⟂ ao movimento
    const dx = b.x - b._px, dz = b.y - b._py;
    const dist = Math.hypot(dx, dz);
    if (dist > 0.02 && dist < 5 * R) {
      m.rotateOnWorldAxis(new THREE.Vector3(dz, 0, -dx).normalize(), dist / R);
    }
    b._px = b.x; b._py = b.y;
    m.position.set(b.x - W / 2, R, b.y - H / 2);
  }
}

// ===========================================================================
// Câmera automática: visão do TACO na sua vez; visão de CIMA na vez do
// adversário, durante a tacada, ou enquanto o Tab estiver segurado.
// ===========================================================================
let camPos = new THREE.Vector3(0, 1250, 320);
const camLook = new THREE.Vector3(0, 0, 0);
let topOverride = false;   // Tab segurado
let zoom = 1;

function cueView() { return amShooter() && phase === 'aim' && !topOverride && !ballInHand; }
function updateCamera(dt) {
  let desired, look;
  if (cueView() && cue() && !cue().potted) {
    const c = cue(), d = aimDir;
    const back = (360 + chargePower * 140) * zoom;
    desired = new THREE.Vector3(c.x - W / 2 - d.x * back, (300 + chargePower * 60) * zoom, c.y - H / 2 - d.y * back);
    look = new THREE.Vector3(c.x - W / 2 + d.x * 160, 0, c.y - H / 2 + d.y * 160);
  } else {
    desired = new THREE.Vector3(0, 1250 * zoom, 300 * zoom); // vista de cima (leve inclinação)
    look = new THREE.Vector3(0, 0, 0);
  }
  const k = 1 - Math.pow(0.0022, dt);
  camPos.lerp(desired, k); camLook.lerp(look, k);
  camera.position.copy(camPos); camera.lookAt(camLook);
}

// ===========================================================================
// Regras do 8-ball (idênticas ao 2D)
// ===========================================================================
function deriveRuleEvents(events) {
  let firstContact = null, cuePotted = false; const potted = [], pottedOrder = [];
  for (const e of events) {
    if (e.type === 'contact' && firstContact === null && (e.a === 0 || e.b === 0)) firstContact = e.a === 0 ? e.b : e.a;
    if (e.type === 'pocket') { potted.push(e.n); pottedOrder.push(e.n); }
    if (e.type === 'cuepotted') cuePotted = true;
  }
  return { firstContact, cuePotted, potted, pottedOrder };
}
function remainingOfGroup(grp) { return balls.filter((b) => !b.potted && groupName(b.n) === grp).length; }
function playerName(no) { return no === myNo ? myName : oppName; }

function evaluateShot(ev) {
  const shooter = currentTurn, opp = shooter === 1 ? 2 : 1;
  let foul = false; const reasons = [];
  if (ev.firstContact === null) { foul = true; reasons.push('a branca não tocou em nenhuma bola'); }
  if (ev.cuePotted) { foul = true; reasons.push('a branca caiu (scratch)'); }
  if (ev.firstContact !== null) {
    const fc = groupName(ev.firstContact);
    if (game.open) { if (fc === 'eight') { foul = true; reasons.push('acertou a 8 primeiro com a mesa aberta'); } }
    else {
      const myGrp = game.groups[shooter];
      const cleared = remainingOfGroup(myGrp) === 0;
      if (cleared) { if (fc !== 'eight') { foul = true; reasons.push('devia acertar a 8 primeiro'); } }
      else if (fc !== myGrp) { foul = true; reasons.push('acertou a bola do adversário primeiro'); }
    }
  }
  const numbered = ev.potted.filter((n) => n !== 8);
  const eightPotted = ev.potted.includes(8);
  if (eightPotted) {
    const myGrp = game.groups[shooter];
    const clearedNow = myGrp && remainingOfGroup(myGrp) === 0;
    const legal = !foul && !ev.cuePotted && !game.open && clearedNow;
    game.gameOver = true; game.winner = legal ? shooter : opp;
    game.lastMsg = legal ? `Bola 8 encaçapada! ${playerName(shooter)} venceu! 🏆`
      : `${playerName(shooter)} encaçapou a 8 fora de hora. ${playerName(opp)} venceu!`;
    return { nextTurn: game.winner, ballInHand: false, foul };
  }
  let continueTurn = false;
  if (!foul && game.open && numbered.length) {
    const first = ev.pottedOrder.find((n) => n !== 8); const grp = groupName(first);
    if (grp === 'solid' || grp === 'stripe') {
      game.groups[shooter] = grp; game.groups[opp] = grp === 'solid' ? 'stripe' : 'solid';
      game.open = false; continueTurn = true;
      game.lastMsg = `${playerName(shooter)} ficou com as ${grp === 'solid' ? 'lisas' : 'listradas'}.`;
    }
  } else if (!foul && !game.open && numbered.length) {
    const myGrp = game.groups[shooter];
    if (numbered.some((n) => groupName(n) === myGrp)) { continueTurn = true; game.lastMsg = `${playerName(shooter)} encaçapou e continua.`; }
    else game.lastMsg = `${playerName(shooter)} encaçapou bola do adversário. Passa a vez.`;
  }
  let nextTurn, bih = false;
  if (foul) { nextTurn = opp; bih = true; game.lastMsg = `Falta: ${reasons[0]}. ${playerName(opp)} joga com a bola na mão.`; }
  else if (continueTurn) nextTurn = shooter;
  else { nextTurn = opp; if (!game.lastMsg) game.lastMsg = `Vez de ${playerName(opp)}.`; }
  return { nextTurn, ballInHand: bih, foul };
}

// ===========================================================================
// Playback da tacada
// ===========================================================================
function startPlayback(shot) {
  if (!shot || !isFinite(shot.duration) || shot.duration < 0) {
    shot = shot || { duration: 0, segments: balls.map(() => []), events: [], finalBalls: balls.map((b) => ({ n: b.n, x: b.x, y: b.y, potted: b.potted })) };
    shot.duration = 0;
  }
  shot.duration = Math.min(shot.duration, 30);
  currentShot = shot; shotElapsed = 0; soundCursor = 0; phase = 'sim';
  if (window.OrbitAudio) OrbitAudio.cue(shot.cueSpeed || 900); // som da tacada (t=0)
  hideAim(); updateHUD();
}

// Dispara os efeitos sonoros conforme a animação passa por cada evento.
function fireShotSounds() {
  if (!window.OrbitAudio || !currentShot || !currentShot.events) return;
  const evs = currentShot.events;
  while (soundCursor < evs.length && evs[soundCursor].t <= shotElapsed) {
    const e = evs[soundCursor++];
    if (e.type === 'contact') OrbitAudio.clack(e.v || 0);
    else if (e.type === 'cushion') OrbitAudio.cushion(e.v || 0);
    else if (e.type === 'pocket' || e.type === 'cuepotted') OrbitAudio.pocket();
  }
}

function endShot() {
  const shot = currentShot; currentShot = null;
  for (const fb of shot.finalBalls) { const b = ballByN(fb.n); if (b) { b.x = fb.x; b.y = fb.y; b.potted = fb.potted; b.vx = b.vy = b.wx = b.wy = b.wz = 0; } }
  const result = evaluateShot(deriveRuleEvents(shot.events));
  currentTurn = result.nextTurn; ballInHand = result.ballInHand;
  if (result.foul && !game.gameOver && window.OrbitAudio) OrbitAudio.foul();
  if (cue().potted) { const c = cue(); c.potted = false; c.x = W * 0.25; c.y = H / 2; }
  if (game.gameOver) { shotQueue = []; showEnd(); return; }
  if (shotQueue.length > 0) { startPlayback(shotQueue.shift()); return; }
  phase = currentTurn === myNo ? 'aim' : 'wait';
  // Bola na mão: libera o cursor (visão de cima) para posicionar pelo feltro.
  if (ballInHand && currentTurn === myNo) exitLock();
  cueOffset = { a: 0, b: 0 }; updateContactDot(); // efeito reseta a cada tacada
  updateHUD();
}

// ===========================================================================
// Rede (mesmo protocolo do 2D)
// ===========================================================================
function hostRoom() { OrbitNet.hostRoom(roomInput, myName, handleNet); } // cria sala (host)
function joinRoom() { OrbitNet.joinRoom(roomInput, myName, handleNet); } // entra pelo código
function send(o) { OrbitNet.send(o); }

function handleNet(msg) {
  switch (msg.t) {
    case '_neterror': setLobbyMsg(msg.msg || 'Erro de rede.'); break;
    case 'joined': myNo = msg.playerNo; setLobbyMsg(`Entrou como Jogador ${myNo}. ${myNo === 1 ? 'Aguardando adversário...' : ''}`); break;
    case 'waiting': setLobbyMsg('Aguardando o segundo jogador entrar na sala...'); break;
    case 'full': setLobbyMsg('Sala cheia! Tente outro nome de sala.'); break;
    case 'start': oppName = msg.opponent || 'Adversário'; currentTurn = msg.startTurn; startGame(); break;
    case 'shot': {
      const shot = { duration: msg.duration, segments: msg.segments, events: msg.events, cueSpeed: msg.cueSpeed, finalBalls: msg.finalBalls };
      if (phase === 'sim' && currentShot) shotQueue.push(shot); else startPlayback(shot);
      break;
    }
    case 'aim': oppAim = msg.a; break;
    case 'ballcue': // adversário reposicionando a branca — reflete em tempo real
      if (currentTurn !== myNo) { const c = cue(); if (c) { c.x = msg.x; c.y = msg.y; c.potted = false; c._px = c.x; c._py = c.y; } }
      break;
    case 'peer_left': if (!game.gameOver) setStatus('Adversário saiu da sala.'); break;
    case 'rematch': doRematch(false); break;
  }
}

// ===========================================================================
// Entrada: mira/tacada (aim mode) + órbita da câmera
// ===========================================================================
const raycaster = new THREE.Raycaster();
const feltPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0); // Y=0
let aimAngle = 0;
let aimDir = { x: 1, y: 0 };
let chargePower = 0, oppAim = null, ctrlCharging = false, chargeAccum = 0, orbiting = false;
let contactMode = false;
const AIM_SENS = 0.0045;  // rad por pixel de mouse (giro do taco)
const CONTACT_SENS = 0.004; // efeito por pixel (Shift)
const ROT_X = 0.0035, ROT_Y = 0.0028;   // sensibilidade da câmera (modo órbita)
const CHARGE_PX = 240;    // puxada (px) para força máxima
const BIH_MOVE = 0.9;     // bola na mão: unidades por pixel
const PULL_MAX = 300;     // puxada no feltro (toque)

const amShooter = () => currentTurn === myNo && !game.gameOver;
// Pointer Lock persistente: o cursor fica OCULTO o tempo todo (só reaparece com
// Esc) e recebemos movimento RELATIVO — gira o taco/câmera infinito, sem sair
// da janela nem depender da posição do cursor.
const isLocked = () => document.pointerLockElement === canvas;
function requestLock() { if (!isLocked() && canvas.requestPointerLock) { try { canvas.requestPointerLock(); } catch (e) {} } }
function exitLock() { if (isLocked() && document.exitPointerLock) { try { document.exitPointerLock(); } catch (e) {} } }
function setAim(ang) { aimAngle = ang; aimDir = { x: Math.cos(ang), y: Math.sin(ang) }; }
function overlapsAny(x, y) { return balls.some((b) => b.n !== 0 && !b.potted && Math.hypot(b.x - x, b.y - y) < 2 * R + 1); }
function screenToFelt(cx, cy) { // usado no toque
  const rect = canvas.getBoundingClientRect();
  const ndc = new THREE.Vector2(((cx - rect.left) / rect.width) * 2 - 1, -((cy - rect.top) / rect.height) * 2 + 1);
  raycaster.setFromCamera(ndc, camera);
  const pt = new THREE.Vector3();
  if (!raycaster.ray.intersectPlane(feltPlane, pt)) return null;
  return { x: pt.x + W / 2, y: pt.z + H / 2 };
}

// ---- Tacada: segurar Ctrl + puxar o mouse pra trás; soltar Ctrl = tacar -----
function beginCharge() {
  if (ctrlCharging || !isLocked() || !(amShooter() && phase === 'aim' && !ballInHand)) return;
  ctrlCharging = true; chargePower = 0; chargeAccum = 0;
  setPowerUI(0);
}
function endCharge() {
  if (!ctrlCharging) return; ctrlCharging = false;
  setPowerUI(0);
  const pw = chargePower; chargePower = 0;
  if (pw > 0.05) shoot(pw);
}
function cancelCharge() {
  if (!ctrlCharging) return; ctrlCharging = false; chargePower = 0;
  setPowerUI(0);
}

// ---- Mouse (ponteiro sempre travado; Esc libera) --------------------------
function onMouseDown(e) {
  // Bola na mão: cursor livre (não travado) + posiciona pelo ponto real do
  // cursor no feltro (visão de cima) — clique fixa e volta a travar pra mirar.
  if (ballInHand && amShooter() && phase === 'aim') {
    const f = screenToFelt(e.clientX, e.clientY);
    if (f && placeCue(f.x, f.y)) { ballInHand = false; sendCue(true); setStatus('Bola posicionada. Mova o mouse para mirar.'); requestLock(); }
    return;
  }
  if (!isLocked()) { requestLock(); return; } // 1º clique trava o cursor
}
function onMouseMove(e) {
  // Reposicionamento (bola na mão): segue o CURSOR real sobre o feltro (sem
  // pointer lock) — nada de movimento relativo, então nunca inverte.
  if (ballInHand && amShooter() && phase === 'aim') {
    const f = screenToFelt(e.clientX, e.clientY);
    if (f) { const c = cue(); c.x = Math.max(R + 1, Math.min(W - R - 1, f.x)); c.y = Math.max(R + 1, Math.min(H - R - 1, f.y)); c._px = c.x; c._py = c.y; sendCue(); }
    return;
  }
  if (!isLocked()) return;
  const mx = e.movementX || 0, my = e.movementY || 0;
  if (contactMode) {
    let a = cueOffset.a + mx * CONTACT_SENS, b = cueOffset.b - my * CONTACT_SENS;
    const m = Math.hypot(a, b), MX = Physics.MAX_OFFSET;
    if (m > MX) { a = a / m * MX; b = b / m * MX; }
    cueOffset = { a, b }; updateContactDot(); return;
  }
  if (ctrlCharging) {
    chargeAccum += my; // puxar pra trás (mouse pra baixo/você) aumenta a força
    chargePower = Math.max(0, Math.min(1, chargeAccum / CHARGE_PX));
    setPowerUI(chargePower);
    sendAim(); return;
  }
  if (amShooter() && phase === 'aim') {
    const sens = AIM_SENS * (window.OrbitSettings ? OrbitSettings.sensitivity() : 1);
    setAim(aimAngle + mx * sens); sendAim();
  }
}
function onMouseUp() {}
function onKeyDown(e) {
  if (window.OrbitMenu && OrbitMenu.isOpen()) return; // menu de pausa aberto
  if (e.key === 'Control' || e.ctrlKey) beginCharge();
  else if (e.key === 'Tab') { e.preventDefault(); topOverride = true; }
  else if (e.key === 'Shift') beginContact();
  else if (e.key === 'h' || e.key === 'H') toggleControls();
}
function onKeyUp(e) {
  if (e.key === 'Control') endCharge();
  else if (e.key === 'Tab') { e.preventDefault(); topOverride = false; }
  else if (e.key === 'Shift') endContact();
}
function onLockChange() { if (!isLocked()) { cancelCharge(); endContact(); topOverride = false; } updateHUD(); }

// ---- Ajuste do ponto de contato/efeito (segurar Shift) --------------------
function beginContact() {
  if (contactMode || !isLocked() || ctrlCharging || !(amShooter() && phase === 'aim' && !ballInHand)) return;
  contactMode = true;
  document.getElementById('contact').classList.add('show');
  updateContactDot();
}
function endContact() {
  if (!contactMode) return; contactMode = false;
  document.getElementById('contact').classList.remove('show');
}
function updateContactDot() {
  const l = 50 + (cueOffset.a / Physics.MAX_OFFSET) * 42;
  const t = 50 - (cueOffset.b / Physics.MAX_OFFSET) * 42;
  const cd = document.getElementById('contactDot'); if (cd) { cd.style.left = l + '%'; cd.style.top = t + '%'; }
  const ed = document.getElementById('effectDot'); if (ed) { ed.style.left = l + '%'; ed.style.top = t + '%'; }
}
// Abre/fecha o painel de controles (botão CONTROLES ou tecla H).
function toggleControls() {
  const k = document.getElementById('keys'), b = document.getElementById('ctrlBtn');
  const hidden = k.classList.toggle('hidden');
  b.classList.toggle('open', !hidden);
}
// Atualiza a barra de força (altura, marcador e número).
function setPowerUI(p) {
  const pct = Math.round(Math.max(0, Math.min(1, p)) * 100);
  const f = document.getElementById('powerFill'); if (f) f.style.height = pct + '%';
  const m = document.getElementById('powerMark'); if (m) m.style.bottom = pct + '%';
  const t = document.getElementById('powerPct'); if (t) t.textContent = pct;
}

// ---- Toque (sem Ctrl): 1 dedo = puxar a branca; 2 dedos = girar ------------
let touchCharging = false;
function onTouchStart(e) {
  if (e.touches.length >= 2) { orbiting = true; lastMouse = { x: e.touches[0].clientX, y: e.touches[0].clientY }; return; }
  const t = e.touches[0]; lastMouse = { x: t.clientX, y: t.clientY };
  if (amShooter() && phase === 'aim') {
    if (ballInHand) { const f = screenToFelt(t.clientX, t.clientY); if (f && placeCue(f.x, f.y)) { ballInHand = false; sendCue(true); setStatus('Bola posicionada.'); } return; }
    touchCharging = true; chargePower = 0; setPowerUI(0); return;
  }
  orbiting = true;
}
function onTouchMove(e) {
  const t = e.touches[0]; const cur = { x: t.clientX, y: t.clientY };
  if (touchCharging) {
    const felt = screenToFelt(cur.x, cur.y);
    if (felt) { const c = cue(); const dx = c.x - felt.x, dy = c.y - felt.y, d = Math.hypot(dx, dy); if (d > 3) { aimDir = { x: dx / d, y: dy / d }; chargePower = Math.max(0, Math.min(1, d / PULL_MAX)); } setPowerUI(chargePower); sendAim(); }
    return;
  }
  lastMouse = cur; // câmera é automática (taco/topo); toque só mira/atira
}
function onTouchEnd() {
  if (touchCharging) { touchCharging = false; setPowerUI(0); const pw = chargePower; chargePower = 0; if (pw > 0.05) shoot(pw); return; }
  orbiting = false;
}
let lastAimSent = 0;
function sendAim() {
  const now = performance.now(); if (now - lastAimSent < 60) return; lastAimSent = now;
  send({ t: 'aim', a: { ang: Math.atan2(aimDir.y, aimDir.x), pow: chargePower } });
}
let lastCueSent = 0;
function sendCue(force) {
  const now = performance.now(); if (!force && now - lastCueSent < 50) return; lastCueSent = now;
  const c = cue(); if (c) send({ t: 'ballcue', x: c.x, y: c.y });
}

function shoot(power) {
  const c = cue();
  const dir = Physics.squirtedDir(aimDir, cueOffset.a);
  let strike = Physics.cueStrike(power, dir, cueOffset.a, cueOffset.b);
  if (strike.miscue) { strike = { vx: dir.x * power * MAX_SHOT * 0.15, vy: dir.y * power * MAX_SHOT * 0.15, wx: 0, wy: 0, wz: 0 }; game.lastMsg = 'Miscue! Tacada fraca.'; }
  c.vx = strike.vx; c.vy = strike.vy; c.wx = strike.wx; c.wy = strike.wy; c.wz = strike.wz;
  cueOffset = { a: 0, b: 0 }; endContact(); updateContactDot(); // efeito reseta ao centro após a tacada
  const snapshot = balls.map((b) => ({ n: b.n, x: b.x, y: b.y, vx: b.vx, vy: b.vy, wx: b.wx, wy: b.wy, wz: b.wz, potted: b.potted }));
  const shot = Physics.simulateShot(snapshot);
  send({ t: 'shot', segments: shot.segments, duration: shot.duration, events: shot.events, cueSpeed: shot.cueSpeed, finalBalls: shot.finalBalls });
  startPlayback(shot);
}

// Bola na mão
function placeCue(x, y) {
  x = Math.max(R + 1, Math.min(W - R - 1, x)); y = Math.max(R + 1, Math.min(H - R - 1, y));
  if (balls.some((b) => b.n !== 0 && !b.potted && Math.hypot(b.x - x, b.y - y) < 2 * R + 1)) return false;
  const c = cue(); c.x = x; c.y = y; c._px = x; c._py = y; c.potted = false; return true;
}

// Previsão simples para a linha de mira (coords físicas)
function predict(dir) {
  const c = cue(); let x = c.x, y = c.y; const step = 4;
  for (let i = 0; i < 700; i++) {
    x += dir.x * step; y += dir.y * step;
    for (const b of balls) { if (b.n === 0 || b.potted) continue; if (Math.hypot(b.x - x, b.y - y) < 2 * R) return { x, y, ball: b }; }
    for (const p of Physics.TABLE.pockets) if (Math.hypot(p.x - x, p.y - y) < p.cap) return { x: p.x, y: p.y, ball: null };
    if (x < R || x > W - R || y < R || y > H - R) return { x: Math.max(R, Math.min(W - R, x)), y: Math.max(R, Math.min(H - R, y)), ball: null };
  }
  return { x, y, ball: null };
}

function hideAim() { aimLine.visible = false; cueStick.visible = false; ghostBall.visible = false; }
function updateAimVisuals() {
  const showMine = amShooter() && phase === 'aim' && !ballInHand;
  const showOpp = !amShooter() && phase === 'wait' && oppAim;
  // Widgets de força e efeito só aparecem na sua vez de mirar.
  document.getElementById('cueControls').classList.toggle('show', showMine);
  if (!showMine && !showOpp) { hideAim(); return; }
  const c = cue(); if (!c || c.potted) { hideAim(); return; }
  const dir = showMine ? aimDir : { x: Math.cos(oppAim.ang), y: Math.sin(oppAim.ang) };
  const shootDir = showMine ? Physics.squirtedDir(dir, cueOffset.a) : dir;
  const pr = predict(shootDir);
  const a = to3(c.x, c.y, R), b = to3(pr.x, pr.y, R);
  aimLine.geometry.setFromPoints([a, b]); aimLine.computeLineDistances(); aimLine.visible = true;
  ghostBall.position.copy(b); ghostBall.visible = !!pr.ball;
  // taco atrás da branca, apontando na direção da tacada (recua com a força)
  const pw = showMine ? chargePower : (oppAim ? oppAim.pow : 0);
  const back = 45 + pw * 150, stickLen = 520;
  const dir3 = new THREE.Vector3(dir.x, 0, dir.y).normalize();
  const center = to3(c.x, c.y, R + 6).addScaledVector(dir3, -(back + stickLen / 2));
  cueStick.position.copy(center);
  cueStick.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir3);
  cueStick.visible = true;
}

// ===========================================================================
// HUD
// ===========================================================================
// Linha de mensagem transitória (embaixo do banner): faltas, "bola posicionada" etc.
function setStatus(t) { const e = document.getElementById('turnHint'); if (e) e.textContent = t || ''; }
function setLobbyMsg(t) { document.getElementById('lobbyMsg').textContent = t; }

// Cor de cada bola (lisas 1-7, listradas 9-15 repetem as cores).
function ballColor(n) {
  const base = n >= 9 ? n - 8 : n;
  return ({ 1: '#f2c531', 2: '#2f6fd6', 3: '#d23b34', 4: '#7b3fa0', 5: '#e07a2f', 6: '#2f9e56', 7: '#8a3b2f', 8: '#141414' })[base] || '#999';
}
// Chips: mostra as 7 bolas do grupo; as já encaçapadas ficam apagadas (cinza).
function buildChips(el, grp) {
  el.innerHTML = '';
  if (!grp) return;
  const nums = grp === 'solid' ? [1, 2, 3, 4, 5, 6, 7] : [9, 10, 11, 12, 13, 14, 15];
  for (const n of nums) {
    const b = balls.find((x) => x.n === n);
    const potted = !b || b.potted;
    const c = document.createElement('div');
    c.className = 'chip' + (potted ? ' potted' : '');
    const col = ballColor(n);
    c.style.background = grp === 'stripe'
      ? `linear-gradient(to bottom, #f4f6f8 0 27%, ${col} 27% 73%, #f4f6f8 73%)`
      : col;
    el.appendChild(c);
  }
}
// Barras da série no centro: vitórias do oponente (azul) + suas (verde) + resto.
function buildDashes(oppNo) {
  const el = document.getElementById('dashes'); el.innerHTML = '';
  const ow = matchScore[oppNo] || 0, mw = matchScore[myNo] || 0;
  for (let i = 0; i < SERIES_GAMES; i++) {
    const d = document.createElement('i');
    if (i < ow) d.style.background = '#3b82f6';
    else if (i < ow + mw) d.style.background = '#34d399';
    el.appendChild(d);
  }
}
// Texto curto do banner (estado da vez / ação).
function bannerText() {
  if (game.gameOver) return game.winner === myNo ? 'VOCÊ VENCEU' : 'FIM DE JOGO';
  if (currentTurn === myNo) {
    if (ballInHand) return 'BOLA NA MÃO';
    if (!isLocked()) return 'CLIQUE PARA MIRAR';
    return 'SUA VEZ';
  }
  return 'VEZ DE ' + (oppName || 'ADVERSÁRIO').toUpperCase();
}

function updateHUD() {
  const oppNo = myNo === 1 ? 2 : 1;
  const meName = myName || ('Jogador ' + myNo);
  const opName = oppName || ('Jogador ' + oppNo);
  // Esquerda = oponente, direita = você (como no design).
  document.getElementById('nmL').textContent = opName;
  document.getElementById('nmR').textContent = meName;
  document.getElementById('avL').textContent = (opName.trim().charAt(0) || 'A').toUpperCase();
  document.getElementById('avR').textContent = (meName.trim().charAt(0) || 'V').toUpperCase();
  const myTurn = currentTurn === myNo && !game.gameOver;
  const opTurn = currentTurn === oppNo && !game.gameOver;
  document.getElementById('plL').classList.toggle('turn', opTurn);
  document.getElementById('plR').classList.toggle('turn', myTurn);
  document.getElementById('dotL').classList.toggle('on', opTurn);
  document.getElementById('dotR').classList.toggle('on', myTurn);

  for (const [side, pl] of [['L', oppNo], ['R', myNo]]) {
    const g = game.groups[pl];
    const rem = g ? remainingOfGroup(g) : 0;
    document.getElementById('grp' + side).textContent = !g ? 'mesa aberta' : (g === 'solid' ? ('lisas · ' + rem) : ('listradas · ' + rem));
    buildChips(document.getElementById('chips' + side), g);
  }

  document.getElementById('sbSeries').textContent = 'MELHOR DE ' + SERIES_GAMES;
  document.getElementById('scoreL').textContent = matchScore[oppNo];
  document.getElementById('scoreR').textContent = matchScore[myNo];
  buildDashes(oppNo);

  document.getElementById('turnPill').classList.toggle('mine', myTurn);
  document.getElementById('statusText').textContent = bannerText();
  setStatus(game.gameOver ? '' : (game.lastMsg || ''));
}

// ===========================================================================
// Lobby / início / fim
// ===========================================================================
function startGame() {
  document.getElementById('lobby').classList.add('hidden');
  document.getElementById('endOverlay').classList.add('hidden');
  makeBalls();
  game.open = true; game.groups = { 1: null, 2: null }; game.gameOver = false; game.winner = 0; game.lastMsg = '';
  ballInHand = false; cueOffset = { a: 0, b: 0 }; currentShot = null; shotQueue = []; updateContactDot();
  setAim(0);
  phase = currentTurn === myNo ? 'aim' : 'wait';
  if (window.OrbitAudio) OrbitAudio.startMusic(); // música só a partir daqui
  for (const b of balls) { const m = ballMeshes[b.n]; if (m) { m.quaternion.set(0, 0, 0, 1); m.position.set(b.x - W / 2, R, b.y - H / 2); m.visible = true; } }
  updateHUD();
}
function showEnd() {
  // Conta a vitória na série (determinístico → os dois lados incrementam igual).
  matchScore[game.winner] = (matchScore[game.winner] || 0) + 1;
  matchOver = matchScore[game.winner] >= SERIES_TARGET;
  const won = game.winner === myNo;
  if (window.OrbitAudio) { won ? OrbitAudio.win() : OrbitAudio.lose(); }
  const t = document.getElementById('endTitle'), m = document.getElementById('endMsg'), btn = document.getElementById('rematchBtn');
  if (matchOver) {
    t.textContent = won ? '🏆 Você venceu o melhor de 5!' : '😞 Você perdeu o melhor de 5';
    m.textContent = `Placar final: ${matchScore[1]} – ${matchScore[2]}. ${game.lastMsg}`;
    btn.textContent = 'Nova série';
  } else {
    t.textContent = won ? '🎉 Você venceu a partida!' : 'Você perdeu a partida';
    m.textContent = `${game.lastMsg} Placar da série: ${matchScore[1]} – ${matchScore[2]}.`;
    btn.textContent = 'Próxima partida';
  }
  document.getElementById('rematchMsg').textContent = '';
  document.getElementById('endOverlay').classList.remove('hidden');
  phase = 'ended';
  updateHUD();
}
function doRematch(initiator) {
  if (matchOver) { matchScore = { 1: 0, 2: 0 }; matchOver = false; } // fim da série → zera para a próxima
  currentTurn = 1; if (initiator) send({ t: 'rematch' }); startGame();
}

// ===========================================================================
// Loop
// ===========================================================================
let last = 0;
function loop(ts) {
  requestAnimationFrame(loop);
  const dt = last ? Math.min((ts - last) / 1000, 0.05) : 0.016; last = ts;
  if (phase === 'sim' && currentShot) {
    shotElapsed = Math.min(shotElapsed + dt, currentShot.duration);
    const states = Physics.evaluateShotAt(currentShot.segments, shotElapsed, balls);
    for (let i = 0; i < balls.length; i++) { balls[i].x = states[i].x; balls[i].y = states[i].y; balls[i].potted = states[i].potted; }
    fireShotSounds();
    if (shotElapsed >= currentShot.duration) endShot();
  }
  syncMeshes();
  updateAimVisuals();
  updateCamera(dt);
  renderer.render(scene, camera);
}

function resize() {
  const w = window.innerWidth, h = window.innerHeight;
  renderer.setSize(w, h); camera.aspect = w / h; camera.updateProjectionMatrix();
}

// ===========================================================================
// Bind
// ===========================================================================
// Fundo 360° do bar: panorâmica equirretangular (2:1) em public/env/.
// Em vez de um "céu no infinito" (que deixa o bar gigante e colado), mapeamos
// a imagem numa ESFERA GRANDE em volta da mesa. Assim o bar fica longe, tem
// parallax quando a câmera gira e parece uma sala de verdade (mais imersão).
// BG_RADIUS controla o "tamanho da sala": maior = bar mais distante/menor.
const BG_RADIUS = 6000;
let bgSphere = null;
function loadEnvironment() {
  const CANDIDATES = ['env/bar.jpg', 'env/bar.jpeg', 'env/bar.png', 'env/bar.webp'];
  const loader = new THREE.TextureLoader();
  let i = 0;
  (function tryNext() {
    if (i >= CANDIDATES.length) return; // nenhum arquivo → segue com a cor atual
    const url = CANDIDATES[i++];
    loader.load(url, (tex) => {
      if (THREE.sRGBEncoding) tex.encoding = THREE.sRGBEncoding;
      // Esfera da "sala": vista por dentro (scale -1 em x evita espelhar).
      const geo = new THREE.SphereGeometry(BG_RADIUS, 60, 40);
      geo.scale(-1, 1, 1);
      const mat = new THREE.MeshBasicMaterial({ map: tex });
      if ('toneMapped' in mat) mat.toneMapped = false;
      bgSphere = new THREE.Mesh(geo, mat);
      bgSphere.position.set(0, 0, 0); // centrada na mesa
      scene.add(bgSphere);
      // Reflexos/iluminação do ambiente nas bolas (MeshStandardMaterial).
      try {
        tex.mapping = THREE.EquirectangularReflectionMapping;
        const pmrem = new THREE.PMREMGenerator(renderer);
        pmrem.compileEquirectangularShader();
        scene.environment = pmrem.fromEquirectangular(tex).texture;
        scene.traverse((o) => {
          if (o.isMesh && o !== bgSphere && o.material && 'envMapIntensity' in o.material) {
            o.material.envMapIntensity = o.userData.shiny ? 0.8 : 0.3;
            o.material.needsUpdate = true;
          }
        });
      } catch (e) { /* PMREM indisponível: fica só o fundo */ }
    }, undefined, () => tryNext()); // erro de carga → tenta a próxima extensão
  })();
}

function init() {
  if (!initRenderer()) return; // sem WebGL: mostra aviso e não tenta montar a cena 3D
  // Usa o colisor extraído do modelo (contorno real das tabelas), se disponível.
  if (window.TABLE3D_COLLIDER && Physics.setTable) {
    const ok = Physics.setTable(window.TABLE3D_COLLIDER);
    console.log(ok ? 'Colisor do modelo 3D ativo.' : 'Colisor do modelo falhou; usando analítico.');
  }
  buildTable(); buildBalls(); buildAimHelpers();
  loadEnvironment(); // fundo 360° do bar (se houver arquivo em env/)
  camPos.set(0, 780, 900); camLook.set(0, 0, 0);
  resize(); window.addEventListener('resize', resize);

  canvas.addEventListener('mousedown', onMouseDown);
  window.addEventListener('mousemove', onMouseMove);
  window.addEventListener('mouseup', onMouseUp);
  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('keyup', onKeyUp);
  document.addEventListener('pointerlockchange', onLockChange);
  window.addEventListener('blur', cancelCharge); // cancela a carga se perder o foco
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  canvas.addEventListener('wheel', (e) => { e.preventDefault(); zoom = Math.max(0.6, Math.min(1.8, zoom + e.deltaY * 0.0012)); }, { passive: false });
  canvas.addEventListener('touchstart', (e) => { e.preventDefault(); onTouchStart(e); }, { passive: false });
  canvas.addEventListener('touchmove', (e) => { e.preventDefault(); onTouchMove(e); }, { passive: false });
  canvas.addEventListener('touchend', (e) => { e.preventDefault(); onTouchEnd(e); }, { passive: false });

  const readName = () => (document.getElementById('name').value || 'Jogador').trim().slice(0, 20);
  const lockInputs = () => { ['createBtn', 'joinBtn'].forEach((id) => { document.getElementById(id).disabled = true; }); };

  if (window.OrbitMenu) {
    OrbitMenu.init({
      has3D: true,
      canOpen: () => phase !== 'lobby',
      onQuit: () => location.reload(),
    });
  }

  document.getElementById('createBtn').addEventListener('click', () => {
    if (window.OrbitAudio) OrbitAudio.unlock();
    myName = readName();
    roomInput = OrbitNet.makeCode();
    document.getElementById('roomCodeVal').textContent = roomInput;
    document.getElementById('roomShare').hidden = false;
    lockInputs();
    setLobbyMsg('Sala criada. Aguardando o adversário entrar com o código...');
    hostRoom();
  });
  document.getElementById('joinBtn').addEventListener('click', () => {
    if (window.OrbitAudio) OrbitAudio.unlock();
    const code = (document.getElementById('joinCode').value || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (code.length < 3) { setLobbyMsg('Digite o código da sala que o host te enviou.'); return; }
    myName = readName(); roomInput = code;
    lockInputs();
    setLobbyMsg('Conectando à sala ' + code + '...'); joinRoom();
  });
  document.getElementById('copyCodeBtn').addEventListener('click', () => {
    const code = document.getElementById('roomCodeVal').textContent;
    const btn = document.getElementById('copyCodeBtn');
    const done = () => { btn.textContent = 'Copiado!'; setTimeout(() => { btn.textContent = 'Copiar'; }, 1500); };
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(code).then(done).catch(done);
    else done();
  });
  document.getElementById('joinCode').addEventListener('input', (e) => { e.target.value = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''); });

  document.getElementById('rematchBtn').addEventListener('click', () => { document.getElementById('rematchMsg').textContent = 'Aguardando o adversário...'; doRematch(true); });
  document.getElementById('ctrlBtn').addEventListener('click', toggleControls);

  requestAnimationFrame(loop);
}
init();
