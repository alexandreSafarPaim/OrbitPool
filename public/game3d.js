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
let currentShot = null, shotElapsed = 0, shotQueue = [];
let cueOffset = { a: 0, b: 0 };

const game = { open: true, groups: { 1: null, 2: null }, gameOver: false, winner: 0, lastMsg: '' };

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

    const twoD = document.createElement('button');
    twoD.textContent = '▶ Jogar a versão 2D';
    twoD.style.cssText = 'margin:0;background:#22303f';
    twoD.onclick = () => { location.href = 'index.html'; };

    wrap.appendChild(copyBtn); wrap.appendChild(tip); wrap.appendChild(twoD);
    m.parentNode.appendChild(wrap);
  }
  const b = document.getElementById('joinBtn');
  if (b) { b.disabled = true; b.style.opacity = 0.5; b.textContent = 'WebGL indisponível'; }
}

const scene = new THREE.Scene();
scene.background = new THREE.Color('#0a0e14');
const camera = new THREE.PerspectiveCamera(45, 1, 10, 9000);

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
    return { nextTurn: game.winner, ballInHand: false };
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
  return { nextTurn, ballInHand: bih };
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
  currentShot = shot; shotElapsed = 0; phase = 'sim';
  hideAim(); updateHUD();
}

function endShot() {
  const shot = currentShot; currentShot = null;
  for (const fb of shot.finalBalls) { const b = ballByN(fb.n); if (b) { b.x = fb.x; b.y = fb.y; b.potted = fb.potted; b.vx = b.vy = b.wx = b.wy = b.wz = 0; } }
  const result = evaluateShot(deriveRuleEvents(shot.events));
  currentTurn = result.nextTurn; ballInHand = result.ballInHand;
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
function connect() {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  ws = new WebSocket(`${proto}://${location.host}`);
  ws.onopen = () => send({ t: 'join', room: roomInput, name: myName });
  ws.onmessage = (e) => { let m; try { m = JSON.parse(e.data); } catch (_) { return; } handleNet(m); };
  ws.onclose = () => setLobbyMsg('Conexão encerrada. Recarregue a página.');
}
function send(o) { if (ws && ws.readyState === 1) ws.send(JSON.stringify(o)); }

function handleNet(msg) {
  switch (msg.t) {
    case 'joined': myNo = msg.playerNo; setLobbyMsg(`Entrou como Jogador ${myNo}. ${myNo === 1 ? 'Aguardando adversário...' : ''}`); break;
    case 'waiting': setLobbyMsg('Aguardando o segundo jogador entrar na sala...'); break;
    case 'full': setLobbyMsg('Sala cheia! Tente outro nome de sala.'); break;
    case 'start': oppName = msg.opponent || 'Adversário'; currentTurn = msg.startTurn; startGame(); break;
    case 'shot': {
      const shot = { duration: msg.duration, segments: msg.segments, events: msg.events, finalBalls: msg.finalBalls };
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
  document.getElementById('powerWrap').classList.add('show');
}
function endCharge() {
  if (!ctrlCharging) return; ctrlCharging = false;
  document.getElementById('powerWrap').classList.remove('show');
  document.getElementById('powerFill').style.height = '0%';
  const pw = chargePower; chargePower = 0;
  if (pw > 0.05) shoot(pw);
}
function cancelCharge() {
  if (!ctrlCharging) return; ctrlCharging = false; chargePower = 0;
  document.getElementById('powerWrap').classList.remove('show');
  document.getElementById('powerFill').style.height = '0%';
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
    document.getElementById('powerFill').style.height = (chargePower * 100) + '%';
    sendAim(); return;
  }
  if (amShooter() && phase === 'aim') { setAim(aimAngle + mx * AIM_SENS); sendAim(); }
}
function onMouseUp() {}
function onKeyDown(e) {
  if (e.key === 'Control' || e.ctrlKey) beginCharge();
  else if (e.key === 'Tab') { e.preventDefault(); topOverride = true; }
  else if (e.key === 'Shift') beginContact();
  else if (e.key === 'h' || e.key === 'H') document.getElementById('keys').classList.toggle('collapsed');
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
  const d = document.getElementById('contactDot');
  d.style.left = (50 + (cueOffset.a / Physics.MAX_OFFSET) * 42) + '%';
  d.style.top = (50 - (cueOffset.b / Physics.MAX_OFFSET) * 42) + '%';
}

// ---- Toque (sem Ctrl): 1 dedo = puxar a branca; 2 dedos = girar ------------
let touchCharging = false;
function onTouchStart(e) {
  if (e.touches.length >= 2) { orbiting = true; lastMouse = { x: e.touches[0].clientX, y: e.touches[0].clientY }; return; }
  const t = e.touches[0]; lastMouse = { x: t.clientX, y: t.clientY };
  if (amShooter() && phase === 'aim') {
    if (ballInHand) { const f = screenToFelt(t.clientX, t.clientY); if (f && placeCue(f.x, f.y)) { ballInHand = false; sendCue(true); setStatus('Bola posicionada.'); } return; }
    touchCharging = true; chargePower = 0; document.getElementById('powerWrap').classList.add('show'); return;
  }
  orbiting = true;
}
function onTouchMove(e) {
  const t = e.touches[0]; const cur = { x: t.clientX, y: t.clientY };
  if (touchCharging) {
    const felt = screenToFelt(cur.x, cur.y);
    if (felt) { const c = cue(); const dx = c.x - felt.x, dy = c.y - felt.y, d = Math.hypot(dx, dy); if (d > 3) { aimDir = { x: dx / d, y: dy / d }; chargePower = Math.max(0, Math.min(1, d / PULL_MAX)); } document.getElementById('powerFill').style.height = (chargePower * 100) + '%'; sendAim(); }
    return;
  }
  lastMouse = cur; // câmera é automática (taco/topo); toque só mira/atira
}
function onTouchEnd() {
  if (touchCharging) { touchCharging = false; document.getElementById('powerWrap').classList.remove('show'); document.getElementById('powerFill').style.height = '0%'; const pw = chargePower; chargePower = 0; if (pw > 0.05) shoot(pw); return; }
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
  send({ t: 'shot', segments: shot.segments, duration: shot.duration, events: shot.events, finalBalls: shot.finalBalls });
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
function setStatus(t) { document.getElementById('status').textContent = t; }
function setLobbyMsg(t) { document.getElementById('lobbyMsg').textContent = t; }
function groupLabel(g) { return !g ? 'mesa aberta' : (g === 'solid' ? '● lisas' : '◐ listradas'); }
function updateHUD() {
  const n1 = myNo === 1 ? myName : oppName, n2 = myNo === 1 ? oppName : myName;
  document.querySelector('#p1 .pn').textContent = n1 + (myNo === 1 ? ' (você)' : '');
  document.querySelector('#p2 .pn').textContent = n2 + (myNo === 2 ? ' (você)' : '');
  document.getElementById('p1').classList.toggle('active', currentTurn === 1);
  document.getElementById('p2').classList.toggle('active', currentTurn === 2);
  document.getElementById('p1g').textContent = groupLabel(game.groups[1]);
  document.getElementById('p2g').textContent = groupLabel(game.groups[2]);
  let s;
  if (game.gameOver) s = game.lastMsg;
  else if (currentTurn === myNo) {
    if (ballInHand) s = 'Bola na mão — mova o cursor e clique no feltro para posicionar a branca.';
    else if (!isLocked()) s = 'Sua vez! Clique na tela para travar o cursor (Esc libera).';
    else s = 'Mova o mouse para girar o taco. Segure Ctrl e puxe o mouse para trás para dar força; solte o Ctrl para tacar.';
  }
  else s = `Vez de ${oppName}...`;
  if (game.lastMsg && !game.gameOver) s = game.lastMsg + (currentTurn === myNo ? ' Sua vez!' : '');
  setStatus(s);
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
  for (const b of balls) { const m = ballMeshes[b.n]; if (m) { m.quaternion.set(0, 0, 0, 1); m.position.set(b.x - W / 2, R, b.y - H / 2); m.visible = true; } }
  updateHUD();
}
function showEnd() {
  const won = game.winner === myNo;
  document.getElementById('endTitle').textContent = won ? '🏆 Você venceu!' : '😞 Você perdeu';
  document.getElementById('endMsg').textContent = game.lastMsg;
  document.getElementById('rematchMsg').textContent = '';
  document.getElementById('endOverlay').classList.remove('hidden');
  phase = 'ended';
}
function doRematch(initiator) { currentTurn = 1; if (initiator) send({ t: 'rematch' }); startGame(); }

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
function init() {
  if (!initRenderer()) return; // sem WebGL: mostra aviso e não tenta montar a cena 3D
  // Usa o colisor extraído do modelo (contorno real das tabelas), se disponível.
  if (window.TABLE3D_COLLIDER && Physics.setTable) {
    const ok = Physics.setTable(window.TABLE3D_COLLIDER);
    console.log(ok ? 'Colisor do modelo 3D ativo.' : 'Colisor do modelo falhou; usando analítico.');
  }
  buildTable(); buildBalls(); buildAimHelpers();
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

  document.getElementById('joinBtn').addEventListener('click', () => {
    myName = (document.getElementById('name').value || 'Jogador').trim().slice(0, 20);
    roomInput = (document.getElementById('room').value || 'sala1').trim().slice(0, 24);
    setLobbyMsg('Conectando...'); connect();
  });
  document.getElementById('rematchBtn').addEventListener('click', () => { document.getElementById('rematchMsg').textContent = 'Aguardando o adversário...'; doRematch(true); });

  requestAnimationFrame(loop);
}
init();
