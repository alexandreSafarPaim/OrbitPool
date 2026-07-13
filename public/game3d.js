/* =========================================================================
   Bilhar 3D — cliente Three.js sobre o MESMO motor de física (physics.js) e o
   MESMO protocolo de rede do jogo 2D (join/shot/aim/rematch). A física roda no
   plano (x∈[0,W], y∈[0,H]); aqui só renderizamos em 3D e mapeamos as posições.
   Mapeamento: mundo3D = (px - W/2, altura, py - H/2), com o feltro em Y=0.
   ========================================================================= */
'use strict';

// ---- i18n: T(chave, params) → texto no idioma atual (i18n.js) --------------
const T = (k, p) => (window.OrbitI18N ? OrbitI18N.t(k, p) : k);

// ---- Cores das bolas (iguais ao 2D) ---------------------------------------
const SOLID = { 1: '#f4c430', 2: '#1f5fd0', 3: '#d0322b', 4: '#6a2fa0', 5: '#e07b18', 6: '#1a8f4a', 7: '#7a1f1f' };
const colorFor = (n) => (n === 8 ? '#161616' : (n <= 7 ? SOLID[n] : SOLID[n - 8]));
// Regras puras (compartilhadas com o servidor ranqueado): rules.js
const isStripe = OrbitRules.isStripe;
const groupName = OrbitRules.groupName;
const RACK_NUMBERS = OrbitRules.RACK_NUMBERS;
const MAXDRAG_PX = 190;   // arraste (px de tela) para potência máxima

// ===========================================================================
// Estado de jogo (espelha o 2D)
// ===========================================================================
let balls = [];
let myNo = 0, oppName = T('default.opp'), myName = T('default.you');
let currentTurn = 1;
// ---- Salas 1v1 e 2v2 (duplas) ---------------------------------------------
// players: playerNo → { name, team (1|2) }. TURN_ORDER: rotação fixa de
// tacadas — 1v1: [1,2]; 2v2: [A1, B1, A2, B2] (padrão scotch doubles: alterna
// time E parceiro; quem encaçapa legal continua na vez).
let roomSlots = 2;                 // 2 = 1v1, 4 = 2v2
let players = { 1: { name: T('default.you'), team: 1 }, 2: { name: T('default.opp'), team: 2 } };
let TURN_ORDER = [1, 2];
let iAmHost = false;
// Linha guia: configuração DA SALA (host define no lobby; vale p/ todos).
// No treino com bot é preferência local (hotkey L), persistida.
let roomGuide = true;
let botGuide = true;
try { botGuide = localStorage.getItem('orbitpool.guide') !== '0'; } catch (e) {}
const guideOn = () => (botLevel ? botGuide : roomGuide);
let lobbyRoster = [];              // lista do lobby 2v2: [{no,name}]
let teamSel = {};                  // escolha de times do host: no → 1|2
const teamOf = (no) => (players[no] ? players[no].team : (no === 1 ? 1 : 2));
const nextTurnAfter = (no) => OrbitRules.nextTurnAfter(TURN_ORDER, no);
// Modo treino (single-player): botLevel != null → o adversário é a IA (jogador 2).
let botLevel = null; const BOT_NO = 2; let botTimer = null;
const botName = (level) => T(({ iniciante: 'botname.iniciante', amador: 'botname.amador', pro: 'botname.pro', mineirinho: 'botname.mineirinho' })[level] || 'botname.default');
let phase = 'lobby';            // lobby | aim | sim | wait | ended
let ballInHand = false;
let ws = null, roomInput = 'sala1';
let currentShot = null, shotElapsed = 0, shotQueue = [], soundCursor = 0;
let cueOffset = { a: 0, b: 0 };

const game = { open: true, groups: { 1: null, 2: null }, gameOver: false, winner: 0, lastMsg: '' };

// Série melhor-de-5 (primeiro a 3 vitórias vence o match). Placar sincronizado
// sem rede extra: os dois lados calculam o vencedor de cada partida de forma
// idêntica (mesma timeline determinística), então incrementam igual.
const SERIES_GAMES = 3, SERIES_TARGET = 2; // melhor de 3 (primeiro a 2)
let roomSeries = true; // config da sala (host): série ligada? (default sim)
// Série só existe em sala 1v1/2v2 com a opção ligada — bot e ranqueado são únicas.
const seriesOn = () => !botLevel && !rankedMode && roomSeries;
// ---- Ranqueado (servidor autoritativo): flags e estado vindos do Worker ----
let rankedMode = false;   // partida atual é ranqueada?
let rankedState = null;   // 'state' autoritativo anexado ao último 'shot'
let rankedResult = null;  // {winner, reason, elo} do fim de partida
let rankedElo = null;     // ELO dos dois lados no início ({1:..,2:..})
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
// ===========================================================================
// Aceleração gráfica: WebGL FUNCIONA, mas por SOFTWARE (SwiftShader/llvmpipe)?
// Isso indica "Usar aceleração de hardware" desligado no navegador — o jogo
// roda, mas engasga. Mostra um modal recomendando ativar.
// ===========================================================================
function detectSoftwareGL() {
  try {
    const gl = renderer && renderer.getContext ? renderer.getContext() : null;
    if (!gl) return false;
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    const name = String(ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : (gl.getParameter(gl.RENDERER) || ''));
    return /swiftshader|llvmpipe|softpipe|software\s?(rasterizer|renderer|adapter)|microsoft basic render/i.test(name);
  } catch (e) { return false; }
}
// Página interna de configurações conforme o navegador.
function gpuSettingsURL() {
  const ua = navigator.userAgent;
  if (/edg\//i.test(ua)) return 'edge://settings/system';
  if (/opr\//i.test(ua)) return 'opera://settings/system';
  if (/firefox/i.test(ua)) return 'about:preferences#general';
  if (navigator.brave) return 'brave://settings/system';
  return 'chrome://settings/system';
}
// Abre o modal de GPU com textos adaptados (usado nos DOIS casos: sem WebGL
// nenhum, e WebGL rodando por software).
function openGpuModal(title, subHTML, dismissLabel) {
  const modal = document.getElementById('gpuModal');
  if (!modal) return;
  const h = modal.querySelector('h1'); if (h) h.textContent = title;
  const sub = modal.querySelector('.sub'); if (sub) sub.innerHTML = subHTML;
  const url = gpuSettingsURL();
  const steps = document.getElementById('gpuSteps');
  if (steps) steps.textContent = url;
  const openBtn = document.getElementById('gpuOpenBtn');
  if (openBtn) {
    openBtn.textContent = T('gpu.open');
    openBtn.onclick = () => {
      // Tenta abrir em nova aba; navegadores BLOQUEIAM abrir páginas internas
      // (chrome:// etc.) a partir de sites — nesse caso, copia o endereço e
      // orienta a colar numa aba nova.
      let w = null;
      try { w = window.open(url, '_blank'); } catch (e) { w = null; }
      if (!w) {
        const done = () => { openBtn.textContent = T('gpu.copied'); };
        if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(url).then(done).catch(done);
        else done();
      }
    };
  }
  const dis = document.getElementById('gpuDismissBtn');
  if (dis) { dis.textContent = dismissLabel; dis.onclick = () => modal.classList.add('hidden'); }
  modal.classList.remove('hidden');
}

function maybeWarnSoftwareGL() {
  if (!detectSoftwareGL()) return;
  openGpuModal(T('gpu.slow.title'), T('gpu.slow.body'), T('gpu.playAnyway'));
}

// WebGL indisponível de vez: mesmo modal, botões desabilitados (sem trocar
// os rótulos — o jogo simplesmente não tem como rodar sem WebGL).
function showWebGLError() {
  ['joinBtn', 'createBtn', 'createBtn2'].forEach((id) => {
    const b = document.getElementById(id);
    if (b) b.disabled = true;
  });
  document.querySelectorAll('.botLvl').forEach((b) => { b.disabled = true; });
  setLobbyMsg(T('gpu.noWebglLobby'));
  openGpuModal(T('gpu.nowebgl.title'), T('gpu.nowebgl.body'), T('gpu.ok'));
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

// Carrega o modelo GLB "Billiard Table" (Futurealiti, sketchfab.com — CC-BY-4.0)
// em PROPORÇÃO NATIVA: a física (W=879.8 × H=449.3) já foi medida dos narizes
// das tabelas deste modelo, então a escala é UNIFORME (354.331 unid/m = 9/pol)
// e nada fica distorcido. Tacos e bolas embutidos no modelo são ocultados.
// Se falhar, mantém a mesa procedural.
function tryLoadModel() {
  if (!window.THREE || !THREE.GLTFLoader) return;
  let loader;
  try { loader = new THREE.GLTFLoader(); } catch (e) { return; }
  loader.load('table.glb', (gltf) => {
    const root = gltf.scene;
    // Constantes MEDIDAS do modelo (metros): centro do campo (linhas de parada
    // do centro da bola na BORRACHA das almofadas) e topo do feltro.
    const S = 354.331;                 // unidades de física por metro
    const X0 = -0.00175, Z0 = 0.00165; // centro do campo no modelo
    const FELT_Y = 0.7794;             // topo do feltro (as bolas assentam aqui)
    root.traverse((o) => {
      if (o.name === 'CueSticks' || o.name === 'BilliardBalls') o.visible = false;
      if (o.isMesh && o.material) {
        o.castShadow = true; o.receiveShadow = true;
        const mt = o.material;
        if (/metal/i.test(o.name) || /lambert/i.test(mt.name || '')) {
          // aros/metal das caçapas: brilho moderado
          if ('metalness' in mt) mt.metalness = 0.55;
          if ('roughness' in mt) mt.roughness = 0.45;
          o.userData.envI = 0.45;
        } else {
          // FELTRO e MADEIRA: foscos (sem reflexo espelhado do ambiente)
          if ('metalness' in mt) mt.metalness = 0;
          if ('roughness' in mt) mt.roughness = 0.96;
          o.userData.envI = 0.08;
        }
        if ('envMapIntensity' in mt) mt.envMapIntensity = o.userData.envI;
        mt.needsUpdate = true;
      }
    });
    const wrap = new THREE.Group();
    wrap.add(root);
    root.scale.set(S, S, S);
    root.position.set(-X0 * S, -FELT_Y * S, -Z0 * S);
    while (tableGroup.children.length) tableGroup.remove(tableGroup.children[0]);
    tableGroup.add(wrap);
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
  // A geometria muda todo frame (setFromPoints), mas a boundingSphere fica
  // ESTAGNADA no valor do 1º render → o frustum culling cortava a linha em
  // certos ângulos de câmera ("guide line sumindo"). Nunca cullar:
  aimLine.frustumCulled = false;
  aimLine.visible = false; scene.add(aimLine);
  cueStick = new THREE.Mesh(new THREE.CylinderGeometry(3.2, 5.5, 520, 16),
    new THREE.MeshStandardMaterial({ color: 0xc9a227, roughness: 0.5 }));
  cueStick.visible = false; scene.add(cueStick);
  ghostBall = new THREE.Mesh(new THREE.SphereGeometry(R * 1.01, 20, 16),
    new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.25 }));
  ghostBall.visible = false; scene.add(ghostBall);
  tryLoadCueModel(); // troca o cilindro pelo modelo 3D do taco, se carregar
}

// Modelo 3D do taco (public/cue.obj + cue_tex.jpg). A geometria é "assada" no
// MESMO referencial do cilindro (eixo Y, centrado, 520 de comprimento, ponta
// fina no +Y), então o posicionamento em updateAimVisuals não muda em nada.
// Se falhar, o cilindro procedural continua.
function tryLoadCueModel() {
  if (!window.THREE || !THREE.OBJLoader) return;
  let loader;
  try { loader = new THREE.OBJLoader(); } catch (e) { return; }
  loader.load('cue.obj', (obj) => {
    let src = null;
    obj.traverse((c) => { if (c.isMesh && !src) src = c; });
    if (!src) return;
    const g = src.geometry;
    // Modelo: comprimento 149.9 no eixo +Z, ponta FINA em z=149.9, base em 0.
    g.rotateX(-Math.PI / 2);              // +Z (ponta) → +Y
    const SCALE = 520 / 149.904;          // assa no comprimento do cilindro atual
    g.scale(SCALE, SCALE, SCALE);
    g.translate(0, -260, 0);              // centraliza (y: 0..520 → -260..260)
    g.computeVertexNormals();
    const tex = new THREE.TextureLoader().load('cue_tex.jpg');
    if (THREE.sRGBEncoding) tex.encoding = THREE.sRGBEncoding;
    const mesh = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ map: tex, roughness: 0.55, metalness: 0 }));
    mesh.castShadow = true;
    mesh.visible = cueStick.visible;
    mesh.position.copy(cueStick.position);
    mesh.quaternion.copy(cueStick.quaternion);
    scene.remove(cueStick);
    cueStick = mesh;
    scene.add(cueStick);
  }, undefined, () => { /* mantém o cilindro */ });
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
// Elevação da câmera na visão do taco (mouse Y na mira): 0 = rente à mesa,
// 1 = quase de cima. SÓ VISUAL — não altera mira, força nem efeito.
let camPitch = 0.48; // equivale à visão padrão anterior (back 360, altura 300)
const PITCH_SENS = 0.0022; // por pixel de mouse
const ELEV_MIN = 0.07, ELEV_MAX = 1.35; // rad

function cueView() { return amShooter() && phase === 'aim' && !topOverride && !ballInHand; }
function updateCamera(dt) {
  let desired, look;
  if (cueView() && cue() && !cue().potted) {
    const c = cue(), d = aimDir;
    // Órbita vertical: elevação controlada por camPitch. Abaixar a câmera
    // APROXIMA da branca (ler o caminho de perto); levantar AFASTA (visão
    // geral). Na altura padrão (0.48) fica na distância de sempre.
    const near = 0.32 + 1.4167 * camPitch; // 0→0.32x · 0.48→1x · 1→1.75x
    const dist = (470 + chargePower * 155) * zoom * near;
    const elev = ELEV_MIN + camPitch * (ELEV_MAX - ELEV_MIN);
    const back = Math.cos(elev) * dist;
    const height = Math.max(Math.sin(elev) * dist, 3 * R); // nunca abaixo do rail
    desired = new THREE.Vector3(c.x - W / 2 - d.x * back, height, c.y - H / 2 - d.y * back);
    look = new THREE.Vector3(c.x - W / 2 + d.x * 160, 0, c.y - H / 2 + d.y * 160);
  } else {
    // Vista de espectador: órbita livre (arrastar no celular gira). O padrão
    // (yaw 0, elev 1.34) equivale à antiga "vista de cima com leve inclinação".
    const dist = 1285 * zoom;
    desired = new THREE.Vector3(
      dist * Math.cos(freeElev) * Math.sin(freeYaw),
      dist * Math.sin(freeElev),
      dist * Math.cos(freeElev) * Math.cos(freeYaw));
    look = new THREE.Vector3(0, 0, 0);
  }
  const k = 1 - Math.pow(0.0022, dt);
  camPos.lerp(desired, k); camLook.lerp(look, k);
  camera.position.copy(camPos); camera.lookAt(camLook);
}

// ===========================================================================
// Regras do 8-ball — a LÓGICA vive em rules.js (OrbitRules, compartilhado
// com o servidor ranqueado). Aqui fica só a camada de apresentação: aplicar
// o resultado ao estado local e traduzir as mensagens (i18n + nomes).
// ===========================================================================
const deriveRuleEvents = OrbitRules.deriveRuleEvents;
// Quantas bolas do grupo ainda estão na mesa (usado pelo HUD).
function remainingOfGroup(grp) { return balls.filter((b) => !b.potted && groupName(b.n) === grp).length; }
function playerName(no) { return (players[no] && players[no].name) || (no === myNo ? myName : oppName) || T('hud.playerN', { n: no }); }
// Nome do time (2v2: "Alex & Bia"; 1v1: nome do jogador).
function teamLabel(team) {
  const names = TURN_ORDER.filter((no) => teamOf(no) === team).map(playerName);
  return names.join(' & ') || T('team.n', { n: team });
}

// Converte a mensagem estruturada de OrbitRules em texto no idioma atual.
function ruleMsgText(m) {
  switch (m.key) {
    case 'msg.win8': return T('msg.win8', { team: teamLabel(m.team) });
    case 'msg.lose8': return T('msg.lose8', { name: playerName(m.shooter), team: teamLabel(m.team) });
    case 'msg.groups': return T('msg.groups', { team: teamLabel(m.team), group: T(m.group === 'solid' ? 'grp.solids' : 'grp.stripes') });
    case 'msg.continue': return T('msg.continue', { name: playerName(m.shooter) });
    case 'msg.oppBall': return T('msg.oppBall', { name: playerName(m.shooter) });
    case 'msg.foul': return T('msg.foul', { reason: T(m.reason), name: playerName(m.next) });
    case 'msg.turnOf': return T('msg.turnOf', { name: playerName(m.next) });
  }
  return '';
}

function evaluateShot(ev) {
  const r = OrbitRules.evaluateShot({
    shooter: currentTurn, turnOrder: TURN_ORDER, teamOf,
    open: game.open, groups: game.groups,
    balls: balls.map((b) => ({ n: b.n, potted: b.potted })), // pós-endShot
  }, ev);
  game.open = r.open; game.groups = r.groups;
  game.gameOver = r.gameOver; game.winner = r.winner;
  // turnOf é fallback: só exibe se não havia mensagem (comportamento original).
  if (r.msg && (!r.msg.fallback || !game.lastMsg)) game.lastMsg = ruleMsgText(r.msg);
  return { nextTurn: r.nextTurn, ballInHand: r.ballInHand, foul: r.foul };
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
  cueDragTarget = null; // o estado final da tacada manda a partir daqui
  for (const fb of shot.finalBalls) { const b = ballByN(fb.n); if (b) { b.x = fb.x; b.y = fb.y; b.potted = fb.potted; b.vx = b.vy = b.wx = b.wy = b.wz = 0; } }
  const result = evaluateShot(deriveRuleEvents(shot.events));
  if (rankedMode && rankedState) {
    // Ranqueado: o veredito do SERVIDOR é a verdade (o local é idêntico em
    // condições normais — isto blinda contra divergência/adulteração).
    result.nextTurn = rankedState.currentTurn; result.ballInHand = rankedState.ballInHand;
    game.open = rankedState.open; game.groups = rankedState.groups;
    game.gameOver = rankedState.gameOver; game.winner = rankedState.winner;
    if (rankedState.msg && (!rankedState.msg.fallback || !game.lastMsg)) game.lastMsg = ruleMsgText(rankedState.msg);
    rankedState = null;
  }
  if (rankedMode && rankedResult && !game.gameOver) { // W.O. chegou durante a animação
    game.gameOver = true; game.winner = rankedResult.winner;
  }
  currentTurn = result.nextTurn; ballInHand = result.ballInHand;
  if (result.foul && !game.gameOver && window.OrbitAudio) OrbitAudio.foul();
  if (cue().potted) { const c = cue(); c.potted = false; c.x = W * 0.25; c.y = H / 2; }
  if (game.gameOver) { shotQueue = []; showEnd(); return; }
  if (shotQueue.length > 0) { startPlayback(shotQueue.shift()); return; }
  phase = currentTurn === myNo ? 'aim' : 'wait';
  // Bola na mão: libera o cursor (visão de cima) para posicionar pelo feltro.
  if (ballInHand && currentTurn === myNo) exitLock();
  cueOffset = { a: 0, b: 0 }; updateContactDot(); // efeito reseta a cada tacada
  // Reconexões que chegaram durante a tacada: manda o estado já assentado.
  if (pendingResyncs.length) { const q = pendingResyncs; pendingResyncs = []; for (const no of q) sendResync(no); }
  updateHUD();
  maybeBotTurn();
}

// ===========================================================================
// Rede (mesmo protocolo do 2D)
// ===========================================================================
function hostRoom(slots) { OrbitNet.hostRoom(roomInput, myName, handleNet, slots); } // cria sala (host)
function joinRoom() { OrbitNet.joinRoom(roomInput, myName, handleNet); }              // entra pelo código
function send(o) { OrbitNet.send(o); }

function handleNet(msg) {
  switch (msg.t) {
    case '_neterror': // falha de rede: no lobby, limpa e libera para tentar de novo
      if (phase === 'lobby') abandonRoom(msg.msg || T('lm.netError'));
      break;
    case 'joined': // servidor (?server) ou host P2P local
      myNo = msg.playerNo; if (msg.slots) roomSlots = msg.slots;
      setLobbyMsg(T('lm.joined', { n: myNo }) + (myNo === 1 ? T('lm.waitingOthers') : ''));
      break;
    case 'assign': // host P2P atribuiu seu número/vagas da sala
      myNo = msg.playerNo; roomSlots = msg.slots || 2;
      setLobbyMsg(T('lm.joinedRoom', { n: myNo }));
      break;
    case 'waiting': setLobbyMsg(roomSlots === 4 ? T('lm.waiting4') : T('lm.waiting2')); break;
    case 'full': if (phase === 'lobby') abandonRoom(T('lm.full')); break;
    case 'roomclosed': // host cancelou a sala no lobby
      if (phase === 'lobby') abandonRoom(T('tl.closed'));
      break;
    case 'lobby': // roster do 2v2 mudou (entrou/saiu alguém)
      lobbyRoster = msg.players || []; roomSlots = msg.slots || roomSlots;
      renderTeamLobby();
      break;
    case 'teams': // host mexeu nos times — convidados veem ao vivo
      teamSel = msg.sel || {};
      renderTeamLobby();
      break;
    case 'roomcfg': // host mudou configurações da sala (linha guia, série etc.)
      roomGuide = msg.guide !== false;
      roomSeries = msg.series !== false;
      if (phase === 'lobby') renderTeamLobby();
      break;
    case 'start': applyStart(msg); break;
    case 'shot': {
      oppAim = null; oppAimTarget = null; cueDragTarget = null; // fim da mira remota
      if (msg.state) rankedState = msg.state; // veredito do servidor (ranqueado)
      if (msg.miscue && msg.shooter === myNo) game.lastMsg = T('msg.miscue');
      const shot = { duration: msg.duration, segments: msg.segments, events: msg.events, cueSpeed: msg.cueSpeed, finalBalls: msg.finalBalls };
      if (phase === 'sim' && currentShot) shotQueue.push(shot); else startPlayback(shot);
      break;
    }
    case 'aim': // mira do adversário: vira ALVO — o loop interpola (rede ~25Hz → 60fps)
      oppAimTarget = msg.a;
      if (!oppAim) oppAim = { ang: msg.a.ang, pow: msg.a.pow || 0 };
      break;
    case 'ballcue': // outro jogador reposicionando a branca — desliza até o alvo
      if (currentTurn !== myNo) {
        const c = cue();
        if (c) { c.potted = false; cueDragTarget = { x: msg.x, y: msg.y }; }
      }
      break;
    case 'peer_left':
      // Ainda no lobby da sala: convidado perdeu o host → sala morreu, volta
      // ao menu (o host nunca recebe isso no lobby — saída de convidado vira
      // atualização de 'lobby').
      if (phase === 'lobby') { if (!iAmHost) abandonRoom(T('tl.closed')); break; }
      if (!game.gameOver) setStatus(T('st.left', { name: msg.no ? playerName(msg.no) : T('default.opp') }));
      break;
    case 'rejoined': { // alguém RECONECTOU numa partida em andamento
      if (phase === 'lobby') break;
      if (msg.name && players[msg.no]) players[msg.no].name = msg.name;
      setStatus(T('st.rejoined', { name: playerName(msg.no) }));
      // O menor nº presente (excluindo quem voltou) é o responsável pelo snapshot.
      const senders = TURN_ORDER.filter((n) => n !== msg.no);
      if (myNo === Math.min(...senders)) queueResync(msg.no);
      break;
    }
    case 'resync': // snapshot da partida (só para quem acabou de reconectar)
      if (msg.for === myNo && phase === 'lobby') applyResync(msg);
      break;
    case 'rematch': doRematch(false); break;
    case 'rejoined_self': break; // nossa própria reconexão (ranqueado)
    case 'ranked_result': { // veredito final do servidor (inclui W.O./timeout)
      rankedResult = msg;
      if (phase === 'sim') break; // fim normal: endShot cuida ao terminar a animação
      if (!game.gameOver) {
        game.gameOver = true; game.winner = msg.winner;
        if (msg.reason !== 'game') game.lastMsg = T(msg.winner === teamOf(myNo) ? 'rk.wonWO' : 'rk.lostWO');
        showEnd();
      } else if (phase === 'ended') renderEndTexts(); // acrescenta o ELO
      break;
    }
  }
}

// ===========================================================================
// Reconexão: snapshot completo do estado para quem voltou pelo código da sala
// ===========================================================================
let pendingResyncs = [];
function queueResync(no) {
  if (phase === 'sim') { if (!pendingResyncs.includes(no)) pendingResyncs.push(no); return; }
  sendResync(no);
}
function sendResync(no) {
  send({
    t: 'resync', for: no,
    players, order: TURN_ORDER, slots: roomSlots,
    game: { open: game.open, groups: game.groups, gameOver: game.gameOver, winner: game.winner },
    matchScore, matchOver, currentTurn, ballInHand, guide: roomGuide, series: roomSeries,
    balls: balls.map((b) => ({ n: b.n, x: b.x, y: b.y, potted: b.potted })),
  });
}
function applyResync(msg) {
  roomGuide = msg.guide !== false;
  roomSeries = msg.series !== false;
  players = msg.players || players;
  TURN_ORDER = (msg.order || [1, 2]).slice();
  roomSlots = msg.slots || 2;
  game.open = msg.game.open; game.groups = msg.game.groups;
  game.gameOver = msg.game.gameOver; game.winner = msg.game.winner; game.lastMsg = '';
  matchScore = msg.matchScore || { 1: 0, 2: 0 }; matchOver = !!msg.matchOver;
  currentTurn = msg.currentTurn; ballInHand = !!msg.ballInHand;
  document.getElementById('lobby').classList.add('hidden');
  const tl = document.getElementById('teamLobby'); if (tl) tl.classList.add('hidden');
  document.getElementById('endOverlay').classList.add('hidden');
  makeBalls();
  for (const sb of (msg.balls || [])) {
    const b = balls.find((x) => x.n === sb.n);
    if (b) { b.x = sb.x; b.y = sb.y; b.potted = sb.potted; b._px = sb.x; b._py = sb.y; b.vx = b.vy = b.wx = b.wy = b.wz = 0; }
  }
  currentShot = null; shotQueue = []; cueOffset = { a: 0, b: 0 }; updateContactDot(); setAim(0);
  phase = currentTurn === myNo ? 'aim' : 'wait';
  if (window.OrbitAudio) OrbitAudio.startMusic();
  updateHUD();
  setStatus(T('st.reconnected'));
}

// Aplica a mensagem 'start' (1v1 legado ou 2v2 com times) e começa o jogo.
function applyStart(msg) {
  rankedMode = !!msg.ranked; rankedState = null; rankedResult = null;
  rankedElo = msg.elo || null;
  if (rankedMode && OrbitNet.markStarted) OrbitNet.markStarted(); // liga a reconexão
  roomGuide = msg.guide !== false; // config da sala (default: ligada)
  roomSeries = msg.series !== false;
  if (msg.players && msg.order) { // host montou a sala (1v1 ou 2v2)
    players = msg.players; TURN_ORDER = msg.order.slice(); roomSlots = msg.slots || (msg.order.length === 4 ? 4 : 2);
  } else { // 1v1: monta o roster local a partir do nome do adversário
    const oppNo = myNo === 1 ? 2 : 1;
    oppName = msg.opponent || T('default.opp');
    players = {};
    players[myNo] = { name: myName, team: myNo };
    players[oppNo] = { name: oppName, team: oppNo };
    TURN_ORDER = [1, 2]; roomSlots = 2;
  }
  const tl = document.getElementById('teamLobby'); if (tl) tl.classList.add('hidden');
  currentTurn = msg.startTurn || TURN_ORDER[0];
  matchScore = { 1: 0, 2: 0 }; matchOver = false;
  startGame();
  // Ranqueado: o SERVIDOR define o rack (o makeBalls local tem jitter próprio).
  if (msg.balls) for (const fb of msg.balls) {
    const b = ballByN(fb.n);
    if (b) { b.x = fb.x; b.y = fb.y; b.potted = !!fb.potted; b._px = b.x; b._py = b.y; }
  }
}

// Sai/fecha a sala e volta ao menu inicial SEM recarregar a página: derruba a
// conexão (OrbitNet.leave), esconde o lobby da sala e destrava os botões.
function abandonRoom(msgText) {
  try { if (OrbitNet.leave) OrbitNet.leave(); } catch (e) {}
  if (window.OrbitAds) OrbitAds.gameplayStop(); // portal: voltou ao menu
  if (window.OrbitPortalGame) OrbitPortalGame.leftRoom();
  myNo = 0; iAmHost = false; lobbyRoster = []; teamSel = {}; roomGuide = true; roomSeries = true;
  const tl = document.getElementById('teamLobby'); if (tl) tl.classList.add('hidden');
  const rs = document.getElementById('roomShare'); if (rs) rs.hidden = true;
  ['createBtn', 'createBtn2', 'joinBtn', 'rankedBtn', 'rkGuestBtn', 'rkLoginBtn'].forEach((id) => { const b = document.getElementById(id); if (b) b.disabled = false; });
  rankedMode = false; rankedState = null; rankedResult = null; rankedElo = null;
  setLobbyMsg(msgText || '');
}

// ===========================================================================
// Lobby de times (2v2): o host distribui os 4 jogadores em 2 duplas
// ===========================================================================
function renderTeamLobby() {
  const ov = document.getElementById('teamLobby');
  if (!ov || phase !== 'lobby' || !lobbyRoster.length) return;
  const is2v2 = roomSlots === 4;
  ov.classList.remove('hidden');
  ov.classList.toggle('solo', !is2v2); // 1v1: botões finos e empilhados
  document.getElementById('tlCode').textContent = roomInput;
  // bloco de compartilhar o código (agora dentro do lobby da sala; todos veem)
  document.getElementById('roomCodeVal').textContent = roomInput;
  document.getElementById('roomShare').hidden = lobbyRoster.length >= roomSlots;
  const tt = document.getElementById('tlTitle');
  if (tt) tt.textContent = is2v2 ? T('tl.title') : '🎱 1v1 — sala';
  const ts = document.getElementById('tlSub');
  if (ts) ts.style.display = is2v2 ? '' : 'none';
  // switch da linha guia (host controla; todos veem)
  const gsw = document.getElementById('tlGuide');
  if (gsw) {
    gsw.checked = roomGuide;
    gsw.disabled = !iAmHost;
    gsw.onchange = iAmHost ? () => {
      roomGuide = gsw.checked;
      send({ t: 'roomcfg', guide: roomGuide, series: roomSeries });
    } : null;
  }
  const ssw = document.getElementById('tlSeries');
  if (ssw) {
    ssw.checked = roomSeries;
    ssw.disabled = !iAmHost;
    ssw.onchange = iAmHost ? () => {
      roomSeries = ssw.checked;
      send({ t: 'roomcfg', guide: roomGuide, series: roomSeries });
    } : null;
  }

  // Times padrão por ordem de entrada (ímpares=A, pares=B); host pode mudar.
  for (const p of lobbyRoster) if (!teamSel[p.no]) teamSel[p.no] = (p.no % 2 === 1) ? 1 : 2;
  for (const k of Object.keys(teamSel)) if (!lobbyRoster.some((p) => p.no === +k)) delete teamSel[k];

  const list = document.getElementById('tlList'); list.innerHTML = '';
  for (const p of lobbyRoster) {
    const row = document.createElement('div'); row.className = 'tlRow';
    const nm = document.createElement('span'); nm.className = 'tlName';
    nm.textContent = p.name + (p.no === myNo ? T('tl.you') : '') + (p.no === 1 ? ' 👑' : '');
    row.appendChild(nm);
    if (!is2v2) { list.appendChild(row); continue; } // 1v1: sem escolha de time
    for (const t of [1, 2]) {
      const b = document.createElement('button');
      b.className = 'tlTeam t' + t + (teamSel[p.no] === t ? ' sel' : '');
      b.textContent = t === 1 ? T('tl.teamA') : T('tl.teamB');
      if (iAmHost) {
        b.addEventListener('click', () => {
          teamSel[p.no] = t;
          send({ t: 'teams', sel: teamSel });
          renderTeamLobby();
        });
      } else b.disabled = true;
      row.appendChild(b);
    }
    list.appendChild(row);
  }
  for (let i = lobbyRoster.length; i < roomSlots; i++) {
    const row = document.createElement('div'); row.className = 'tlRow empty';
    row.innerHTML = '<span class="tlName"></span>'; row.firstChild.textContent = T('tl.waitPlayer');
    list.appendChild(row);
  }

  const nA = lobbyRoster.filter((p) => teamSel[p.no] === 1).length;
  const full = lobbyRoster.length === roomSlots;
  const balanced = !is2v2 || nA === 2;
  document.getElementById('tlRandom').style.display = (iAmHost && is2v2) ? '' : 'none';
  const st = document.getElementById('tlStart');
  st.style.display = iAmHost ? '' : 'none';
  st.disabled = !(full && balanced);
  const cb = document.getElementById('tlCancel');
  if (cb) cb.textContent = iAmHost ? T('tl.close') : T('tl.leave');
  document.getElementById('tlMsg').textContent = !full
    ? T('tl.waiting', { n: lobbyRoster.length, code: roomInput }).replace('/4', '/' + roomSlots)
    : (!balanced ? T('tl.balance')
      : (iAmHost ? T('tl.ready') : T('tl.waitHost')));
  if (window.OrbitPortalGame && roomInput) OrbitPortalGame.showInvite(roomInput); // convite do portal
}

// Host: sorteia as duplas (2x2 aleatório).
function randomTeams() {
  const nos = lobbyRoster.map((p) => p.no);
  for (let i = nos.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [nos[i], nos[j]] = [nos[j], nos[i]]; }
  nos.forEach((no, i) => { teamSel[no] = i < Math.ceil(nos.length / 2) ? 1 : 2; });
  send({ t: 'teams', sel: teamSel });
  renderTeamLobby();
}

// Host: valida, monta a rotação e dá o start para todos (1v1 e 2v2).
function hostStart2v2() {
  let order, pl = {};
  if (roomSlots === 4) {
    const nosA = lobbyRoster.filter((p) => teamSel[p.no] === 1).map((p) => p.no).sort((a, b) => a - b);
    const nosB = lobbyRoster.filter((p) => teamSel[p.no] === 2).map((p) => p.no).sort((a, b) => a - b);
    if (lobbyRoster.length !== 4 || nosA.length !== 2 || nosB.length !== 2) return;
    order = [nosA[0], nosB[0], nosA[1], nosB[1]]; // alterna time e parceiro
    for (const p of lobbyRoster) pl[p.no] = { name: p.name, team: teamSel[p.no] };
  } else {
    if (lobbyRoster.length !== 2) return;
    order = [1, 2];
    for (const p of lobbyRoster) pl[p.no] = { name: p.name, team: p.no };
  }
  const msg = { t: 'start', players: pl, order, startTurn: order[0], slots: roomSlots, guide: roomGuide, series: roomSeries };
  send(msg);
  if (OrbitNet.markStarted) OrbitNet.markStarted();
  applyStart(msg);
}

// ===========================================================================
// Entrada: mira/tacada (aim mode) + órbita da câmera
// ===========================================================================
const raycaster = new THREE.Raycaster();
const feltPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0); // Y=0
let aimAngle = 0;
let aimDir = { x: 1, y: 0 };
let chargePower = 0, oppAim = null, ctrlCharging = false, chargeAccum = 0, orbiting = false;
// Interpolação da mira/arrasto REMOTOS: a rede manda ~25Hz; o loop desliza os
// valores exibidos até esses alvos a 60fps (mascara o "travado" do P2P).
let oppAimTarget = null, cueDragTarget = null;
function lerpAngle(a, b, t) {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
}
let contactMode = false;
const AIM_SENS = 0.0045;  // rad por pixel de mouse (giro do taco)
const CONTACT_SENS = 0.004; // efeito por pixel (Shift)
const ROT_X = 0.0035, ROT_Y = 0.0028;   // sensibilidade da câmera (modo órbita)
const CHARGE_PX = 240;    // puxada (px) para força máxima
const BIH_MOVE = 0.9;     // bola na mão: unidades por pixel
const PULL_MAX = 300;     // puxada no feltro (toque)

const amShooter = () => currentTurn === myNo && !game.gameOver;
// Celular/tablet: dedo no lugar de mouse+teclado → botões touch no HUD.
const IS_MOBILE = (window.matchMedia && matchMedia('(pointer: coarse)').matches) || 'ontouchstart' in window;
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
    if (f && placeCue(f.x, f.y)) { ballInHand = false; sendCue(true); setStatus(T('st.placedAim')); requestLock(); }
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
    const sensX = AIM_SENS * (window.OrbitSettings && OrbitSettings.sensitivityX ? OrbitSettings.sensitivityX() : 1);
    setAim(aimAngle + mx * sensX);
    // Mouse Y: eleva/abaixa o ponto de vista (mouse p/ cima = ver de cima,
    // p/ baixo = rente à mesa). Só câmera — a tacada não muda.
    const sensY = PITCH_SENS * (window.OrbitSettings && OrbitSettings.sensitivityY ? OrbitSettings.sensitivityY() : 1);
    camPitch = Math.max(0, Math.min(1, camPitch - my * sensY));
    saveViewPrefs();
    sendAim();
  }
}
function onMouseUp() {}
// Salva as preferências de câmera (altura/zoom) com debounce.
let viewSaveTimer = null;
function saveViewPrefs() {
  clearTimeout(viewSaveTimer);
  viewSaveTimer = setTimeout(() => {
    try { localStorage.setItem('orbitpool.view', JSON.stringify({ pitch: camPitch, zoom })); } catch (e) {}
  }, 500);
}

// Toast transitório da música no turnHint (restaura o HUD depois).
let musicToastTimer = null;
function musicToast(text) {
  setStatus(text);
  clearTimeout(musicToastTimer);
  musicToastTimer = setTimeout(() => { if (phase !== 'lobby') updateHUD(); }, 2500);
}
function onKeyDown(e) {
  if (window.OrbitMenu && OrbitMenu.isOpen()) return; // menu de pausa aberto
  if (e.key === 'Control' || e.ctrlKey) beginCharge();
  else if (e.key === 'Tab') { e.preventDefault(); topOverride = true; }
  else if (e.key === 'Shift') beginContact();
  else if (e.key === 'h' || e.key === 'H') toggleControls();
  else if ((e.key === 'l' || e.key === 'L') && botLevel) { // linha guia (SÓ treino c/ bot)
    botGuide = !botGuide;
    try { localStorage.setItem('orbitpool.guide', botGuide ? '1' : '0'); } catch (err) {}
    musicToast(botGuide ? '📏 linha guia ativada' : '📏 linha guia desativada');
  }
  // ---- Música: N = próxima · B = anterior · M = pausar/tocar --------------
  else if ((e.key === 'n' || e.key === 'N') && window.OrbitAudio && OrbitAudio.nextMusic) {
    const i = OrbitAudio.nextMusic(); if (i) musicToast('♪ ' + i.title);
  } else if ((e.key === 'b' || e.key === 'B') && window.OrbitAudio && OrbitAudio.prevMusic) {
    const i = OrbitAudio.prevMusic(); if (i) musicToast('♪ ' + i.title);
  } else if ((e.key === 'm' || e.key === 'M') && window.OrbitAudio && OrbitAudio.toggleMusic) {
    const i = OrbitAudio.toggleMusic();
    if (i) musicToast(i.playing ? ('▶ ' + i.title) : T('music.paused'));
  }
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

// ---- Toque (padrão 8 Ball Pool): arrastar na MESA gira o taco;
// FORÇA no slider lateral; PINÇA = zoom. A decisão do que o arrasto faz é
// tomada A CADA movimento (sem flag armada no touchstart — era frágil:
// um toque fantasma de 2 dedos ou timing de fase matava o arrasto todo). ---
const TOUCH_AIM_SENS = 0.005;    // rad por px de arrasto horizontal
const TOUCH_PITCH_SENS = 0.0028; // altura da câmera por px vertical (na mira)
// Órbita LIVRE de espectador (fora da sua vez): arrastar gira ao redor da mesa.
let freeYaw = 0, freeElev = 1.34; // elev ~77° = equivalente à vista de cima antiga
let pinch0 = 0, pinchZoom0 = 1;   // pinça: distância inicial e zoom na largada
function touchDist(e) {
  const a = e.touches[0], b = e.touches[1];
  return Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY) || 1;
}
const TDBG = { start: 0, move: 0, rot: 0, pinchN: 0, nT: 0, moved: 0, dx: 0 };
// Posição anterior POR DEDO (identifier). Usamos changedTouches (só dedos que
// SE MOVERAM) — imune a "toque fantasma" preso (comum em Samsung), que fazia
// touches.length=2 e sequestrava o arrasto pro ramo da pinça.
let tPrev = {};
function onTouchStart(e) {
  TDBG.start++;
  for (const t of e.changedTouches) tPrev[t.identifier] = { x: t.clientX, y: t.clientY };
  if (e.touches.length >= 2) { pinch0 = touchDist(e); pinchZoom0 = zoom; return; }
  const t = e.touches[0];
  lastMouse = { x: t.clientX, y: t.clientY };
  // (bola na mão é tratada no touchmove/touchend — em alguns aparelhos o
  // touchstart do canvas não chega com confiabilidade)
}
function onTouchMove(e) {
  TDBG.move++; TDBG.nT = e.touches.length; TDBG.moved = e.changedTouches.length;
  // PINÇA de verdade = DOIS dedos se movendo no mesmo evento.
  if (e.touches.length >= 2 && e.changedTouches.length >= 2) {
    TDBG.pinchN++;
    if (!pinch0) { pinch0 = touchDist(e); pinchZoom0 = zoom; return; }
    zoom = Math.max(0.6, Math.min(1.8, pinchZoom0 * (pinch0 / touchDist(e))));
    saveViewPrefs();
    for (const t of e.changedTouches) tPrev[t.identifier] = { x: t.clientX, y: t.clientY };
    return;
  }
  // Senão: gira com o dedo que SE MOVEU (mesmo que exista outro toque parado).
  const t = e.changedTouches[0];
  if (!t) return;
  const p = tPrev[t.identifier] || { x: t.clientX, y: t.clientY };
  const dx = t.clientX - p.x, dy = t.clientY - p.y;
  tPrev[t.identifier] = { x: t.clientX, y: t.clientY };
  if (Math.abs(dx) > 90 || Math.abs(dy) > 90) return; // salto: ignora
  if (amShooter() && phase === 'aim' && ballInHand) {
    // BOLA NA MÃO: a branca segue o dedo (solta no touchend p/ fixar)
    const f = screenToFelt(t.clientX, t.clientY);
    if (f) {
      const c = cue();
      c.x = Math.max(R + 1, Math.min(W - R - 1, f.x));
      c.y = Math.max(R + 1, Math.min(H - R - 1, f.y));
      c.potted = false; c._px = c.x; c._py = c.y;
      sendCue();
    }
  } else if (amShooter() && phase === 'aim') {
    TDBG.rot++; TDBG.dx = dx;
    setAim(aimAngle + dx * TOUCH_AIM_SENS);                                // lado = gira taco/câmera
    camPitch = Math.max(0, Math.min(1, camPitch - dy * TOUCH_PITCH_SENS)); // ↑↓ = altura (só visual)
    saveViewPrefs(); sendAim();
  }
  // fora da sua vez / vista de cima: a mesa fica PARADA (só a pinça dá zoom)
}
function onTouchEnd(e) {
  if (e && e.changedTouches) for (const t of e.changedTouches) delete tPrev[t.identifier];
  if (e && e.touches && e.touches.length < 2) pinch0 = 0;
  orbiting = false;
  // BOLA NA MÃO: soltar o dedo fixa a branca (tap = arrasto de 0px, também vale)
  if (amShooter() && phase === 'aim' && ballInHand && e && e.changedTouches && e.changedTouches[0]) {
    const t = e.changedTouches[0];
    const f = screenToFelt(t.clientX, t.clientY);
    if (f && placeCue(f.x, f.y)) { ballInHand = false; sendCue(true); setStatus('Bola posicionada.'); }
    else setStatus('Esse lugar está ocupado — solta noutro ponto.');
  }
}
let lastAimSent = 0;
function sendAim() {
  const now = performance.now(); if (now - lastAimSent < 40) return; lastAimSent = now; // ~25Hz (interpolado no receptor)
  send({ t: 'aim', a: { ang: Math.atan2(aimDir.y, aimDir.x), pow: chargePower } });
}
let lastCueSent = 0;
function sendCue(force) {
  const now = performance.now(); if (!force && now - lastCueSent < 40) return; lastCueSent = now; // ~25Hz (interpolado no receptor)
  const c = cue(); if (c) send({ t: 'ballcue', x: c.x, y: c.y });
}

function shoot(power) {
  if (rankedMode) {
    // Servidor autoritativo: envia só o input; a timeline volta como 'shot'.
    send({ t: 'shotinput', ang: Math.atan2(aimDir.y, aimDir.x), power, a: cueOffset.a, b: cueOffset.b });
    cueOffset = { a: 0, b: 0 }; endContact(); updateContactDot();
    const ctEl = document.getElementById('contact'); if (ctEl) ctEl.classList.remove('show');
    const msB = document.getElementById('mbSpin'); if (msB) msB.classList.remove('on');
    hideAim(); phase = 'wait'; updateHUD();
    return;
  }
  const c = cue();
  // cueStrike já aplica o squirt internamente — passar aimDir puro (aplicar
  // squirtedDir aqui dobraria a deflexão e descasaria da linha de mira).
  const dir = Physics.squirtedDir(aimDir, cueOffset.a); // só p/ fallback de miscue
  let strike = Physics.cueStrike(power, aimDir, cueOffset.a, cueOffset.b);
  if (strike.miscue) { strike = { vx: dir.x * power * MAX_SHOT * 0.15, vy: dir.y * power * MAX_SHOT * 0.15, wx: 0, wy: 0, wz: 0 }; game.lastMsg = T('msg.miscue'); }
  c.vx = strike.vx; c.vy = strike.vy; c.wx = strike.wx; c.wy = strike.wy; c.wz = strike.wz;
  cueOffset = { a: 0, b: 0 }; endContact(); updateContactDot(); // efeito reseta ao centro após a tacada
  // mobile: fecha a bola de efeito, se estava aberta
  const ctEl = document.getElementById('contact'); if (ctEl) ctEl.classList.remove('show');
  const msB = document.getElementById('mbSpin'); if (msB) msB.classList.remove('on');
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
  if (IS_MOBILE) {
    document.body.classList.toggle('ingame', phase !== 'lobby');
    const sb = document.getElementById('powerSlider');
    if (sb) sb.classList.toggle('show', showMine);
  }
  if (!showMine && !showOpp) { hideAim(); return; }
  const c = cue(); if (!c || c.potted) { hideAim(); return; }
  const dir = showMine ? aimDir : { x: Math.cos(oppAim.ang), y: Math.sin(oppAim.ang) };
  const shootDir = showMine ? Physics.squirtedDir(dir, cueOffset.a) : dir;
  const pr = predict(shootDir);
  const a = to3(c.x, c.y, R), b = to3(pr.x, pr.y, R);
  aimLine.geometry.setFromPoints([a, b]); aimLine.computeLineDistances();
  aimLine.visible = guideOn(); // config da sala (ou preferência local no bot)
  ghostBall.position.copy(b); ghostBall.visible = guideOn() && !!pr.ball;
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
    // bolinhas com brilho (visual do design "boteco")
    c.style.background = grp === 'stripe'
      ? `radial-gradient(circle at 34% 28%, rgba(255,255,255,.5), transparent 42%), linear-gradient(to bottom, #f4f6f8 0 27%, ${col} 27% 73%, #f4f6f8 73%)`
      : `radial-gradient(circle at 34% 28%, rgba(255,255,255,.55), transparent 44%), ${col}`;
    el.appendChild(c);
  }
}
// Barras da série no centro: vitórias do time oponente (azul) + do seu (verde).
function buildDashes(oppTeam, myTeam) {
  const el = document.getElementById('dashes'); el.innerHTML = '';
  const ow = matchScore[oppTeam] || 0, mw = matchScore[myTeam] || 0;
  for (let i = 0; i < SERIES_GAMES; i++) {
    const d = document.createElement('i');
    if (i < ow) d.style.background = '#5aa0ff';           // vitórias deles (azul)
    else if (i < ow + mw) d.style.background = '#ffd24a'; // suas (âmbar do tema)
    el.appendChild(d);
  }
}
// Texto curto do banner (estado da vez / ação).
function bannerText() {
  if (game.gameOver) {
    return game.winner === teamOf(myNo)
      ? (roomSlots === 4 ? T('ban.teamWon') : T('ban.youWon'))
      : T('ban.gameOver');
  }
  if (currentTurn === myNo) {
    if (ballInHand) return IS_MOBILE ? T('ban.bihTouch') : T('ban.bih');
    if (IS_MOBILE) return T('ban.yourTurnDrag');
    if (!isLocked()) return T('ban.clickAim');
    return T('ban.yourTurn');
  }
  const nm = playerName(currentTurn).toUpperCase();
  return T('ban.turnOf', { name: nm }) + (roomSlots === 4 && teamOf(currentTurn) === teamOf(myNo) ? T('ban.partner') : '');
}

function updateHUD() {
  const myTeam = teamOf(myNo), oppTeam = myTeam === 1 ? 2 : 1;
  const meName = teamLabel(myTeam) || myName;
  const opName = teamLabel(oppTeam) || oppName;
  // Esquerda = time oponente, direita = seu time (1v1: cada lado é 1 jogador).
  document.getElementById('nmL').textContent = opName;
  document.getElementById('nmR').textContent = meName;
  document.getElementById('avL').textContent = (opName.trim().charAt(0) || 'A').toUpperCase();
  document.getElementById('avR').textContent = (meName.trim().charAt(0) || 'V').toUpperCase();
  const myTurn = teamOf(currentTurn) === myTeam && !game.gameOver;
  const opTurn = !myTurn && !game.gameOver;
  document.getElementById('plL').classList.toggle('turn', opTurn);
  document.getElementById('plR').classList.toggle('turn', myTurn);
  document.getElementById('dotL').classList.toggle('on', opTurn);
  document.getElementById('dotR').classList.toggle('on', myTurn);

  for (const [side, team] of [['L', oppTeam], ['R', myTeam]]) {
    const g = game.groups[team];
    const rem = g ? remainingOfGroup(g) : 0;
    document.getElementById('grp' + side).textContent = !g ? T('grp.open') : (T(g === 'solid' ? 'grp.solids' : 'grp.stripes') + ' · ' + rem);
    buildChips(document.getElementById('chips' + side), g);
  }

  if (seriesOn()) {
    document.getElementById('sbSeries').textContent = T('sb.series', { n: SERIES_GAMES });
    document.getElementById('scoreL').textContent = matchScore[oppTeam];
    document.getElementById('scoreR').textContent = matchScore[myTeam];
    buildDashes(oppTeam, myTeam);
  } else {
    document.getElementById('sbSeries').textContent = T('sb.single');
    document.getElementById('scoreL').textContent = '';
    document.getElementById('scoreR').textContent = '';
    const dl = document.getElementById('dashes'); if (dl) dl.innerHTML = '';
  }

  document.getElementById('turnPill').classList.toggle('mine', currentTurn === myNo && !game.gameOver);
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
  oppAim = null; oppAimTarget = null; cueDragTarget = null;
  setAim(0);
  phase = currentTurn === myNo ? 'aim' : 'wait';
  // etiqueta com o CÓDIGO DA SALA (só multiplayer — útil p/ reconvidar/reconectar)
  const rt = document.getElementById('roomTag');
  if (rt) {
    rt.hidden = !!botLevel || !roomInput;
    const rc = document.getElementById('roomTagCode');
    if (rc) rc.textContent = roomInput;
  }
  if (window.OrbitAudio) OrbitAudio.startMusic(); // música só a partir daqui
  for (const b of balls) { const m = ballMeshes[b.n]; if (m) { m.quaternion.set(0, 0, 0, 1); m.position.set(b.x - W / 2, R, b.y - H / 2); m.visible = true; } }
  if (window.OrbitAds) OrbitAds.gameplayStart(); // portal: sessão de jogo começou
  if (window.OrbitPortalGame) OrbitPortalGame.matchStarted(); // sala fecha p/ novos jogadores
  updateHUD();
  maybeBotTurn();
}
function showEnd() {
  exitLock(); // libera o cursor na hora (pra clicar no overlay de fim de jogo)
  if (window.OrbitAds) { OrbitAds.gameplayStop(); OrbitAds.midgame(); } // portal: intersticial entre partidas
  // Conta a vitória na série (determinístico → todos os lados incrementam igual).
  // Partida ÚNICA (bot/ranqueado/sala com série desligada): sem placar de série.
  if (seriesOn()) {
    matchScore[game.winner] = (matchScore[game.winner] || 0) + 1;
    matchOver = matchScore[game.winner] >= SERIES_TARGET;
  } else matchOver = false;
  const won = game.winner === teamOf(myNo); // vitória do SEU time (1v1: você)
  if (window.OrbitAudio) { won ? OrbitAudio.win() : OrbitAudio.lose(); }
  if (won && window.OrbitPortalGame) OrbitPortalGame.happy(); // confete do portal
  endWon = won;
  renderEndTexts();
  document.getElementById('rematchMsg').textContent = '';
  document.getElementById('endOverlay').classList.remove('hidden');
  phase = 'ended';
  updateHUD();
}
// Textos do overlay de fim (função própria: retraduz se o idioma mudar).
let endWon = false;
function renderEndTexts() {
  const who = roomSlots === 4 ? 'team' : 'you'; // conjugação correta por idioma
  const el = document.getElementById('endTitle'), m = document.getElementById('endMsg'), btn = document.getElementById('rematchBtn');
  if (rankedMode) {
    el.textContent = T(endWon ? 'end.wonGame.you' : 'end.lostGame.you');
    let extra = '';
    if (rankedResult && rankedResult.elo && typeof rankedResult.elo.delta === 'number') {
      const dd = Math.round(rankedResult.elo.delta);
      extra = ' ' + T('rk.eloDelta', { delta: (endWon ? '+' : '\u2212') + dd });
    }
    m.textContent = (game.lastMsg || '') + extra;
    btn.textContent = T('rk.again');
    return;
  }
  if (!seriesOn()) { // partida única (bot ou sala sem série)
    el.textContent = T((endWon ? 'end.wonGame.' : 'end.lostGame.') + who);
    m.textContent = game.lastMsg || '';
    btn.textContent = T('btn.playAgain');
    return;
  }
  if (matchOver) {
    el.textContent = T((endWon ? 'end.wonSeries.' : 'end.lostSeries.') + who);
    m.textContent = T('end.finalScore', { a: matchScore[1], b: matchScore[2] }) + ' ' + game.lastMsg;
    btn.textContent = T('btn.newSeries');
  } else {
    el.textContent = T((endWon ? 'end.wonGame.' : 'end.lostGame.') + who);
    m.textContent = game.lastMsg + ' ' + T('end.seriesScore', { a: matchScore[1], b: matchScore[2] });
    btn.textContent = T('btn.nextGame');
  }
}
function doRematch(initiator) {
  if (rankedMode) { rankedRequeue(); return; } // ranqueado: nova busca na fila
  if (matchOver) { matchScore = { 1: 0, 2: 0 }; matchOver = false; } // fim da série → zera para a próxima
  currentTurn = TURN_ORDER[0]; if (!botLevel && initiator) send({ t: 'rematch' }); startGame();
}

// ===========================================================================
// Treino contra o bot (single-player)
// ===========================================================================
// Lê o nome; se vazio, avisa e destaca o campo (nome é obrigatório p/ jogar).
function getNameOrWarn() {
  // Logado: o nome vem da CONTA (o campo de apelido nem aparece).
  const u = window.OrbitAuth && OrbitAuth.user();
  if (u && u.displayName) return u.displayName.slice(0, 20);
  const v = (document.getElementById('name').value || '').trim().slice(0, 20);
  if (!v) {
    setLobbyMsg(T('lm.nameRequired'));
    const el = document.getElementById('name'); el.classList.add('err'); el.focus();
    return null;
  }
  try { localStorage.setItem('orbitpool.name', v); } catch (e) {} // lembra o apelido
  return v;
}
function startSolo(level) {
  if (window.OrbitAudio) OrbitAudio.unlock();
  const nm = getNameOrWarn(); if (!nm) return;
  myName = nm;
  myNo = 1; botLevel = level; oppName = botName(level);
  roomSlots = 2; iAmHost = false;
  players = { 1: { name: nm, team: 1 }, 2: { name: oppName, team: 2 } };
  TURN_ORDER = [1, 2];
  matchScore = { 1: 0, 2: 0 }; matchOver = false;
  currentTurn = 1; // você quebra
  startGame();
}
// Se for a vez do bot, agenda a jogada dele.
function maybeBotTurn() {
  if (!botLevel || game.gameOver || currentTurn !== BOT_NO || phase === 'sim') return;
  clearTimeout(botTimer);
  botTimer = setTimeout(botTurn, 550);
}
function botTurn() {
  if (!botLevel || game.gameOver || currentTurn !== BOT_NO || phase === 'sim') return;
  const hint = document.getElementById('turnHint');
  if (hint) hint.textContent = T('st.botThinking', { name: oppName });
  // Deixa o "pensando" pintar antes do cálculo (que pode travar ~0.3s nos níveis altos).
  setTimeout(() => {
    if (!botLevel || game.gameOver || currentTurn !== BOT_NO || phase === 'sim') return;
    let dec = null;
    try {
      dec = OrbitBot.decide({
        balls: balls.map((b) => ({ n: b.n, x: b.x, y: b.y, potted: b.potted })),
        botNo: BOT_NO, group: game.groups[BOT_NO], open: game.open,
        ballInHand: ballInHand, level: botLevel,
      });
    } catch (e) { dec = null; }
    if (!dec || !isFinite(dec.ang)) dec = { ang: Math.atan2(H / 2 - cue().y, W / 2 - cue().x), power: 0.5, a: 0, b: 0 };
    if (dec.place) { placeCue(dec.place.x, dec.place.y); ballInHand = false; }
    setAim(dec.ang); cueOffset = { a: dec.a || 0, b: dec.b || 0 };
    oppAim = { ang: dec.ang, pow: dec.power }; // taco mira visivelmente
    const th = dec.think ? dec.think[0] + Math.random() * (dec.think[1] - dec.think[0]) : 1000;
    clearTimeout(botTimer);
    botTimer = setTimeout(() => {
      if (!botLevel || game.gameOver || currentTurn !== BOT_NO || phase === 'sim') return;
      oppAim = null; shoot(dec.power);
    }, th);
  }, 60);
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
  } else {
    // Suavização dos movimentos REMOTOS (taco do adversário / bola na mão):
    // desliza ~95% do caminho em ~65ms — fluido sem atraso perceptível.
    const k = 1 - Math.pow(0.0005, dt);
    if (oppAim && oppAimTarget) {
      oppAim.ang = lerpAngle(oppAim.ang, oppAimTarget.ang, k);
      oppAim.pow = (oppAim.pow || 0) + ((oppAimTarget.pow || 0) - (oppAim.pow || 0)) * k;
    }
    if (cueDragTarget && currentTurn !== myNo) {
      const c = cue();
      if (c && !c.potted) {
        const dx = cueDragTarget.x - c.x, dy = cueDragTarget.y - c.y;
        if (Math.hypot(dx, dy) > 250) { c.x = cueDragTarget.x; c.y = cueDragTarget.y; c._px = c.x; c._py = c.y; } // teleporte: não deslizar
        else { c.x += dx * k; c.y += dy * k; }
      }
    }
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

// Aplica a intensidade dos reflexos do ambiente nos materiais da cena.
function applyEnvIntensity() {
  scene.traverse((o) => {
    if (o.isMesh && o !== bgSphere && o.material && 'envMapIntensity' in o.material) {
      // userData.envI = intensidade definida por material (mesa fosca etc.);
      // sem ela: bolas (shiny) refletem bem, resto pouco.
      o.material.envMapIntensity = o.userData.envI != null ? o.userData.envI : (o.userData.shiny ? 0.8 : 0.3);
      o.material.needsUpdate = true;
    }
  });
}

// Ordem de preferência: 1) CUBEMAP em env/cube/{px,nx,py,ny,pz,nz}.png
// (maior qualidade), 2) idem .jpg, 3) panorâmica equirretangular env/bar.*.
function loadEnvironment() {
  loadCubeEnv('png', () => loadCubeEnv('jpg', () => loadEquirectEnv()));
}

// Cubemap: a "sala" continua sendo uma esfera grande (parallax quando a câmera
// anda), mas amostrando o cubemap POR DIREÇÃO num shader — textureCube garante
// a orientação correta das 6 faces, sem precisar espelhar geometria.
function loadCubeEnv(ext, onFail) {
  const files = ['px', 'nx', 'py', 'ny', 'pz', 'nz'].map((f) => 'env/cube/' + f + '.' + ext);
  new THREE.CubeTextureLoader().load(files, (tex) => {
    if (THREE.sRGBEncoding) tex.encoding = THREE.sRGBEncoding;
    const geo = new THREE.SphereGeometry(BG_RADIUS, 48, 24);
    const mat = new THREE.ShaderMaterial({
      uniforms: { env: { value: tex } },
      vertexShader: 'varying vec3 vDir; void main(){ vDir = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
      // Saída direta (sRGB → sRGB): equivale ao toneMapped=false da panorâmica.
      // -vDir.x: cubemaps são definidos "vistos de FORA"; vistos de dentro é
      // preciso espelhar o X (mesmo flipEnvMap=-1 que o three usa no skybox).
      fragmentShader: 'uniform samplerCube env; varying vec3 vDir; void main(){ vec3 d = normalize(vDir); gl_FragColor = textureCube(env, vec3(-d.x, d.yz)); }',
      side: THREE.BackSide, depthWrite: false, fog: false,
    });
    bgSphere = new THREE.Mesh(geo, mat);
    bgSphere.position.set(0, 0, 0); // centrada na mesa
    scene.add(bgSphere);
    // Reflexos/iluminação do ambiente nas bolas (MeshStandardMaterial).
    try {
      const pmrem = new THREE.PMREMGenerator(renderer);
      pmrem.compileCubemapShader();
      scene.environment = pmrem.fromCubemap(tex).texture;
      applyEnvIntensity();
    } catch (e) { /* PMREM indisponível: fica só o fundo */ }
  }, undefined, onFail);
}

function loadEquirectEnv() {
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
        applyEnvIntensity();
      } catch (e) { /* PMREM indisponível: fica só o fundo */ }
    }, undefined, () => tryNext()); // erro de carga → tenta a próxima extensão
  })();
}

function init() {
  if (!initRenderer()) return; // sem WebGL: mostra aviso e não tenta montar a cena 3D
  maybeWarnSoftwareGL(); // WebGL por software = aceleração desativada → recomenda ativar
  // Usa o colisor extraído do modelo (contorno real das tabelas), se disponível.
  if (window.TABLE3D_COLLIDER && Physics.setTable) {
    const ok = Physics.setTable(window.TABLE3D_COLLIDER);
    console.log(ok ? 'Colisor do modelo 3D ativo.' : 'Colisor do modelo falhou; usando analítico.');
  }
  buildTable(); buildBalls(); buildAimHelpers();
  loadEnvironment(); // fundo 360° do bar (se houver arquivo em env/)
  camPos.set(0, 780, 900); camLook.set(0, 0, 0);
  if (window.OrbitAds) OrbitAds.ready(); // portal: fim do loading (loadingStop)
  // SITE: link de convite ?room=CODIGO → auto-join (sem SDK; funciona em
  // qualquer lugar). No portal o fluxo equivalente usa o SDK logo abaixo.
  if (!window.OrbitPortalGame) {
    const roomParam = new URLSearchParams(location.search).get('room');
    if (roomParam) {
      const code = roomParam.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8);
      if (code.length >= 3) {
        document.getElementById('joinCode').value = code;
        const nickEl = document.getElementById('name');
        const acct = window.OrbitAuth && OrbitAuth.user && OrbitAuth.user();
        if ((acct && acct.displayName) || (nickEl.value || '').trim()) {
          document.getElementById('joinBtn').click(); // nome ok → entra direto
        } else {
          setLobbyMsg(T('lm.nameRequired')); nickEl.focus(); // só falta o apelido
        }
      }
    }
  }
  // Portal: entrou por link de convite → auto-join; instant multiplayer →
  // cria a sala 1v1 direto (o líder da party compartilha pelo botão do site).
  if (window.OrbitPortalGame) (async () => {
    const nickEl = document.getElementById('name');
    const ensureNick = () => {
      const acct = window.OrbitAuth && OrbitAuth.user();
      if (acct && acct.displayName) return true; // conta CG dá o nome
      if ((nickEl.value || '').trim()) return true;
      nickEl.value = 'Player' + Math.floor(100 + Math.random() * 900);
      return true;
    };
    const goJoin = (code) => {
      if (phase !== 'lobby') return; // no meio de uma partida não puxa o jogador
      ensureNick();
      document.getElementById('joinCode').value = String(code).toUpperCase().slice(0, 8);
      document.getElementById('joinBtn').click();
    };
    OrbitPortalGame.onJoinRequest(goJoin); // convites recebidos em tempo real
    const invited = await OrbitPortalGame.inviteParam('room');
    if (invited) {
      goJoin(invited);
    } else if (await OrbitPortalGame.instant()) {
      ensureNick();
      document.getElementById('createBtn').click(); // sala 1v1 + convite ativo
    }
  })();
  resize(); window.addEventListener('resize', resize);

  canvas.addEventListener('mousedown', onMouseDown);
  window.addEventListener('mousemove', onMouseMove);
  window.addEventListener('mouseup', onMouseUp);
  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('keyup', onKeyUp);
  document.addEventListener('pointerlockchange', onLockChange);
  window.addEventListener('blur', cancelCharge); // cancela a carga se perder o foco
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  canvas.addEventListener('wheel', (e) => { e.preventDefault(); zoom = Math.max(0.6, Math.min(1.8, zoom + e.deltaY * 0.0012)); saveViewPrefs(); }, { passive: false });
  canvas.addEventListener('touchstart', (e) => { e.preventDefault(); onTouchStart(e); }, { passive: false });
  canvas.addEventListener('touchmove', (e) => { e.preventDefault(); onTouchMove(e); }, { passive: false });
  canvas.addEventListener('touchend', (e) => { e.preventDefault(); onTouchEnd(e); }, { passive: false });

  const lockInputs = () => { ['createBtn', 'createBtn2', 'joinBtn', 'rankedBtn', 'rkGuestBtn', 'rkLoginBtn'].forEach((id) => { const b = document.getElementById(id); if (b) b.disabled = true; }); };
  document.getElementById('name').addEventListener('input', () => { document.getElementById('name').classList.remove('err'); setLobbyMsg(''); });

  // ---- Preferências persistidas no navegador (voltam na próxima visita) ----
  // Apelido: sempre vem carregado o último usado (editável normalmente).
  // Câmera: altura (camPitch) e zoom preferidos.
  try {
    const savedName = localStorage.getItem('orbitpool.name');
    if (savedName) document.getElementById('name').value = savedName;
    const view = JSON.parse(localStorage.getItem('orbitpool.view') || '{}');
    if (typeof view.pitch === 'number') camPitch = Math.max(0, Math.min(1, view.pitch));
    if (typeof view.zoom === 'number') zoom = Math.max(0.6, Math.min(1.8, view.zoom));
  } catch (e) {}

  if (window.OrbitMenu) {
    OrbitMenu.init({
      has3D: true,
      canOpen: () => phase !== 'lobby',
      onQuit: () => location.reload(),
    });
  }

  document.querySelectorAll('.botLvl').forEach((b) => b.addEventListener('click', () => startSolo(b.dataset.lvl)));

  const createRoom = (slots) => {
    if (window.OrbitAudio) OrbitAudio.unlock();
    const nm = getNameOrWarn(); if (!nm) return;
    botLevel = null; myName = nm; iAmHost = true; roomSlots = slots; // PvP
    teamSel = {}; lobbyRoster = []; roomGuide = true; roomSeries = true;
    roomInput = OrbitNet.makeCode();
    lockInputs();
    setLobbyMsg(slots === 4 ? T('lm.created4') : T('lm.created2'));
    hostRoom(slots);
  };
  // ---- ABAS do menu (Jogar / Ranqueada / Treino) ---------------------------
  const TABS = { tabPlay: 'panelPlay', tabRanked: 'panelRanked', tabBot: 'panelBot' };
  for (const [btnId, panelId] of Object.entries(TABS)) {
    const b = document.getElementById(btnId);
    if (b) b.addEventListener('click', () => {
      for (const [bi, pi] of Object.entries(TABS)) {
        document.getElementById(bi).classList.toggle('sel', bi === btnId);
        document.getElementById(pi).classList.toggle('hidden', pi !== panelId);
      }
      if (btnId === 'tabRanked' && window.OrbitAuth && OrbitAuth.user()) refreshRkStats();
    });
  }

  // ---- CONTA: reflete o estado de login na UI ------------------------------
  const authUI = (u) => {
    const logged = !!u;
    document.getElementById('acctLogged').classList.toggle('hidden', !logged);
    document.getElementById('acctGuest').classList.toggle('hidden', logged);
    document.getElementById('nickBlock').style.display = logged ? 'none' : '';
    // painel ranqueado: cadeado p/ deslogado, fila p/ logado
    document.getElementById('rkLockBox').style.display = logged ? 'none' : '';
    document.getElementById('rkLoginBtn').classList.toggle('hidden', logged);
    document.getElementById('rkGuestBtn').classList.toggle('hidden', logged || !!window.OrbitPortal);
    document.getElementById('rankedBtn').classList.toggle('hidden', !logged);
    document.getElementById('rkStats').classList.toggle('hidden', !logged);
    if (!logged) return;
    const nm = u.displayName || (u.email ? u.email.split('@')[0] : T('default.you'));
    document.getElementById('acctName').textContent = nm + (u.isAnonymous ? ' 🎭' : '');
    document.getElementById('acctInitial').textContent = (nm.trim().charAt(0) || '?').toUpperCase();
    document.getElementById('acctElo').textContent = T('acct.loggedNoElo');
    refreshRkStats();
  };
  // Busca ELO/posição/V-D e preenche a linha da conta + cartão da aba ranqueada.
  const refreshRkStats = () => {
    if (!window.OrbitRanked || !OrbitRanked.me) return;
    OrbitRanked.me().then((me) => {
      if (!me) return;
      // ELO só aparece depois da PRIMEIRA ranqueada (1000 é o valor-base de
      // todo mundo — mostrar antes de jogar só confunde).
      document.getElementById('acctElo').textContent = me.placed
        ? T('acct.logged', { elo: Math.round(me.elo) }) : T('acct.loggedNoElo');
      document.getElementById('rkStatElo').textContent = me.placed ? Math.round(me.elo) : '—';
      document.getElementById('rkStatPos').textContent = me.placed && me.rank ? '#' + me.rank + '/' + me.total : '—';
      document.getElementById('rkStatRec').textContent = me.placed ? me.wins + ' · ' + me.losses : T('rk.unplaced');
    }).catch(() => {});
  };
  if (window.OrbitAuth) OrbitAuth.onChange(authUI);

  // ---- MODAL de login (e-mail/senha, criar conta, Google) ------------------
  let authMode = 'signin'; // signin | signup
  const authModalEl = document.getElementById('authModal');
  const authErrEl = document.getElementById('authErr');
  const setAuthMode = (m) => {
    authMode = m;
    document.getElementById('authNameRow').classList.toggle('hidden', m !== 'signup');
    document.getElementById('authSubmitTxt').textContent = T(m === 'signup' ? 'auth.signup' : 'auth.signin');
    document.getElementById('authSwapTxt').textContent = T(m === 'signup' ? 'auth.haveAccount' : 'auth.noAccount');
    document.getElementById('authSwapLink').textContent = T(m === 'signup' ? 'auth.toSignin' : 'auth.create');
    document.getElementById('authPass').setAttribute('autocomplete', m === 'signup' ? 'new-password' : 'current-password');
    authErrEl.textContent = '';
  };
  const openAuth = () => {
    if (window.OrbitPortal && OrbitAuth.showAuthPrompt) { OrbitAuth.showAuthPrompt(); return; } // portal: prompt nativo
    setAuthMode('signin'); authModalEl.classList.remove('hidden'); document.getElementById('authEmail').focus();
  };
  const closeAuth = () => authModalEl.classList.add('hidden');
  document.getElementById('authClose').addEventListener('click', closeAuth);
  authModalEl.addEventListener('click', (e) => { if (e.target === authModalEl) closeAuth(); });
  document.getElementById('authSwapLink').addEventListener('click', (e) => { e.preventDefault(); setAuthMode(authMode === 'signup' ? 'signin' : 'signup'); });
  const authBusy = (on) => { ['authSubmit', 'authGoogle'].forEach((id) => { document.getElementById(id).disabled = on; }); };
  document.getElementById('authSubmit').addEventListener('click', async () => {
    const email = document.getElementById('authEmail').value;
    const pass = document.getElementById('authPass').value;
    const nome = document.getElementById('authName').value;
    if (authMode === 'signup' && !(nome || '').trim()) { authErrEl.textContent = T('auth.err.needName'); return; }
    authErrEl.textContent = ''; authBusy(true);
    try {
      if (authMode === 'signup') await OrbitAuth.signUpEmail(nome, email, pass);
      else await OrbitAuth.signInEmail(email, pass);
      closeAuth();
    } catch (e) { authErrEl.textContent = T(OrbitAuth.errKey(e)); }
    authBusy(false);
  });
  document.getElementById('authGoogle').addEventListener('click', async () => {
    authErrEl.textContent = ''; authBusy(true);
    try { await OrbitAuth.signInGoogle(); closeAuth(); }
    catch (e) { authErrEl.textContent = T(OrbitAuth.errKey(e)); }
    authBusy(false);
  });
  document.getElementById('loginBtn').addEventListener('click', openAuth);
  document.getElementById('rkLoginBtn').addEventListener('click', openAuth);
  document.getElementById('logoutBtn').addEventListener('click', () => { if (window.OrbitAuth) OrbitAuth.signOut(); });

  // ---- RANQUEADO: busca partida com identidade verificada -----------------
  const startRanked = () => {
    if (window.OrbitAudio) OrbitAudio.unlock();
    const nm = getNameOrWarn(); if (!nm) return;
    if (!window.OrbitRanked) { setLobbyMsg(T('rk.connFail')); return; }
    botLevel = null; myName = nm; iAmHost = false; roomSlots = 2;
    OrbitRanked.getToken(nm).then((tok) => {
      if (!tok) { openAuth(); return; }
      lockInputs();
      setLobbyMsg(T('rk.searching'));
      OrbitNet.playRanked(tok, nm, handleNet);
    });
  };
  const rkGuest = document.getElementById('rkGuestBtn');
  if (rkGuest) rkGuest.addEventListener('click', async () => {
    if (window.OrbitAudio) OrbitAudio.unlock();
    const nm = getNameOrWarn(); if (!nm) return; // convidado precisa do apelido
    try { await OrbitAuth.signInGuest(nm); startRanked(); }
    catch (e) { setLobbyMsg(T(OrbitAuth.errKey(e))); }
  });
  window.rankedRequeue = () => { // "jogar de novo" do fim de partida ranqueada
    document.getElementById('endOverlay').classList.add('hidden');
    try { OrbitNet.leave(); } catch (e) {}
    abandonRoom('');
    startRanked();
  };
  const rkB = document.getElementById('rankedBtn');
  if (rkB) rkB.addEventListener('click', startRanked);

  // ---- Leaderboard da temporada (modal) ------------------------------------
  const lbModal = document.getElementById('lbModal');
  const lbClose = () => lbModal && lbModal.classList.add('hidden');
  const lbCloseBtn = document.getElementById('lbCloseBtn');
  if (lbCloseBtn) lbCloseBtn.addEventListener('click', lbClose);
  if (lbModal) lbModal.addEventListener('click', (e) => { if (e.target === lbModal) lbClose(); }); // clique fora fecha
  const lbB = document.getElementById('lbBtn');
  if (lbB) lbB.addEventListener('click', () => {
    const list = document.getElementById('lbList'), season = document.getElementById('lbSeason');
    if (!lbModal || !list) return;
    lbModal.classList.remove('hidden');
    season.textContent = '';
    list.innerHTML = '<div class="lbEmpty">…</div>';
    if (!window.OrbitRanked) { list.innerHTML = ''; list.textContent = T('rk.connFail'); return; }
    OrbitRanked.leaderboard(20).then((data) => {
      season.textContent = T('lb.title', { season: data.season });
      list.textContent = '';
      if (!data.players.length) {
        const e = document.createElement('div'); e.className = 'lbEmpty';
        e.textContent = T('lb.empty'); list.appendChild(e); return;
      }
      data.players.forEach((pl, i) => {
        const row = document.createElement('div'); row.className = 'lbRow';
        const mk = (cls, txt) => { const s = document.createElement('span'); s.className = cls; s.textContent = txt; row.appendChild(s); };
        mk('pos', (i + 1) + '.');
        mk('nm', pl.name);
        mk('elo', String(Math.round(pl.elo)));
        mk('wl', T('lb.wl', { w: pl.wins, l: pl.losses }));
        list.appendChild(row);
      });
    }).catch(() => { list.textContent = T('rk.connFail'); });
  });

  document.getElementById('createBtn').addEventListener('click', () => createRoom(2));
  const c2 = document.getElementById('createBtn2');
  if (c2) c2.addEventListener('click', () => createRoom(4));
  const tlR = document.getElementById('tlRandom');
  if (tlR) tlR.addEventListener('click', () => { if (iAmHost) randomTeams(); });
  const tlS = document.getElementById('tlStart');
  if (tlS) tlS.addEventListener('click', () => { if (iAmHost) hostStart2v2(); });
  const tlC = document.getElementById('tlCancel');
  if (tlC) tlC.addEventListener('click', () => abandonRoom(iAmHost ? T('tl.closedByYou') : T('tl.leftByYou')));
  document.getElementById('joinBtn').addEventListener('click', () => {
    if (window.OrbitAudio) OrbitAudio.unlock();
    const nm = getNameOrWarn(); if (!nm) return;
    const code = (document.getElementById('joinCode').value || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (code.length < 3) { setLobbyMsg(T('lm.enterCode')); return; }
    botLevel = null; myName = nm; roomInput = code;
    lockInputs();
    setLobbyMsg(T('lm.connectingRoom', { code: code })); joinRoom();
  });
  const inviteURL = (code) => {
    if (window.OrbitPortalGame) { const l = OrbitPortalGame.inviteLink(code); if (l) return l; }
    return location.origin + location.pathname + '?room=' + encodeURIComponent(code);
  };
  document.getElementById('copyCodeBtn').addEventListener('click', () => {
    const code = inviteURL(document.getElementById('roomCodeVal').textContent);
    const btn = document.getElementById('copyCodeBtn');
    const done = () => { btn.textContent = T('btn.copied'); setTimeout(() => { btn.textContent = T('btn.copy'); }, 1500); };
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(code).then(done).catch(done);
    else done();
  });
  document.getElementById('joinCode').addEventListener('input', (e) => { e.target.value = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''); });

  document.getElementById('rematchBtn').addEventListener('click', () => { document.getElementById('rematchMsg').textContent = T('end.waitingOpp'); doRematch(true); });
  document.getElementById('ctrlBtn').addEventListener('click', toggleControls);
  const rtEl = document.getElementById('roomTag');
  if (rtEl) rtEl.addEventListener('click', () => {
    const done = () => { setStatus('Código ' + roomInput + ' copiado!'); };
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(inviteURL(roomInput)).then(done).catch(done);
    else done();
  });

  // ================= CONTROLES TOUCH (só no celular) =================
  if (IS_MOBILE) {
    document.body.classList.add('mobile');
    const $ = (id) => document.getElementById(id);
    // ☰ menu de pausa
    $('mbMenu').addEventListener('click', () => { if (window.OrbitMenu) OrbitMenu.open(); });
    // 🔝 ver de cima (toggle, não precisa segurar como o Tab)
    $('mbTop').addEventListener('click', () => {
      topOverride = !topOverride;
      $('mbTop').classList.toggle('on', topOverride);
    });
    // 📷 altura da câmera: alterna rente → padrão → alto
    $('mbCam').addEventListener('click', () => {
      camPitch = camPitch < 0.3 ? 0.48 : (camPitch < 0.7 ? 0.9 : 0.12);
      saveViewPrefs();
    });
    // 🎯 efeito: abre a bola grande; arrasta nela p/ escolher o ponto
    $('mbSpin').addEventListener('click', () => {
      const c = document.getElementById('contact');
      c.classList.toggle('show');
      $('mbSpin').classList.toggle('on', c.classList.contains('show'));
    });
    // 🎵 próxima música
    $('mbMusic').addEventListener('click', () => {
      if (window.OrbitAudio && OrbitAudio.nextMusic) { const i = OrbitAudio.nextMusic(); if (i) musicToast('♪ ' + i.title); }
    });
    // Toque na BOLA DE EFEITO: posição absoluta do dedo vira (a,b)
    const contactEl = document.getElementById('contact');
    const setSpinFromTouch = (ev) => {
      const t = ev.touches ? ev.touches[0] : ev;
      const r = contactEl.getBoundingClientRect();
      let a = ((t.clientX - r.left) / r.width - 0.5) * 2 * Physics.MAX_OFFSET * 1.15;
      let b = -((t.clientY - r.top) / r.height - 0.5) * 2 * Physics.MAX_OFFSET * 1.15;
      const m = Math.hypot(a, b), MX = Physics.MAX_OFFSET;
      if (m > MX) { a = a / m * MX; b = b / m * MX; }
      cueOffset = { a, b }; updateContactDot();
      ev.preventDefault();
    };
    contactEl.addEventListener('touchstart', setSpinFromTouch, { passive: false });
    contactEl.addEventListener('touchmove', setSpinFromTouch, { passive: false });
    // SLIDER DE FORÇA (estilo 8 Ball Pool): pressiona o trilho, PUXA PRA
    // BAIXO até a força desejada e SOLTA = tacada. Voltar ao topo cancela.
    const slider = $('powerSlider'), track = $('psTrack'),
          fill = $('psFill'), handle = $('psHandle'), psPct = $('psPct');
    let charging = false;
    const setSlider = (pw) => {
      fill.style.height = (pw * 100) + '%';
      handle.style.top = (pw * 100) + '%';
      psPct.textContent = Math.round(pw * 100) + '%';
      psPct.style.top = (pw * 100) + '%';
    };
    const powerFromTouch = (ev) => {
      const r = track.getBoundingClientRect();
      return Math.max(0, Math.min(1, (ev.touches[0].clientY - r.top) / r.height));
    };
    slider.addEventListener('touchstart', (ev) => {
      ev.preventDefault();
      if (!(amShooter() && phase === 'aim' && !ballInHand)) return;
      charging = true; slider.classList.add('on');
      chargePower = powerFromTouch(ev); setPowerUI(chargePower); setSlider(chargePower); sendAim();
    }, { passive: false });
    slider.addEventListener('touchmove', (ev) => {
      ev.preventDefault();
      if (!charging) return;
      chargePower = powerFromTouch(ev); setPowerUI(chargePower); setSlider(chargePower); sendAim();
    }, { passive: false });
    const releaseShot = (ev) => {
      if (ev) ev.preventDefault();
      if (!charging) return;
      charging = false; slider.classList.remove('on');
      const pw = chargePower; chargePower = 0; setPowerUI(0); setSlider(0);
      if (pw > 0.05) shoot(pw); else sendAim(); // soltar no topo = cancela
    };
    slider.addEventListener('touchend', releaseShot, { passive: false });
    slider.addEventListener('touchcancel', releaseShot, { passive: false });
  }

  // Troca de idioma: re-renderiza os textos dinâmicos na hora.
  document.addEventListener('orbitpool:lang', () => {
    if (phase !== 'lobby') updateHUD();
    renderTeamLobby();
    if (phase === 'ended') renderEndTexts();
  });

  // ---- DEBUG de toque (abra com ?touchdebug na URL) ----------------------
  if (/[?&]touchdebug/.test(location.search)) {
    const d = document.createElement('div');
    d.style.cssText = 'position:fixed;left:4px;top:4px;z-index:999;background:rgba(0,0,0,.85);color:#0f0;' +
      'font:11px/1.5 monospace;padding:8px;pointer-events:none;white-space:pre;border-radius:6px;max-width:94vw';
    document.body.appendChild(d);
    let ts = 0, tm = 0, lastTarget = '-', lastDx = 0;
    canvas.addEventListener('touchstart', () => { ts++; }, true);
    canvas.addEventListener('touchmove', () => { tm++; }, true);
    // quem está RECEBENDO os toques? (capture na janela vê tudo)
    window.addEventListener('touchstart', (e) => {
      const t = e.target;
      lastTarget = (t.id ? '#' + t.id : t.tagName) + (t === canvas ? ' (canvas ✓)' : ' (INTERCEPTADO!)');
    }, true);
    window.addEventListener('touchmove', (e) => {
      if (e.touches && e.touches[0]) lastDx = e.touches[0].clientX;
    }, true);
    (function upd() {
      d.textContent =
        'canvas ts:' + ts + '  tm:' + tm + '  alvo: ' + lastTarget + '\n' +
        'DENTRO: start:' + TDBG.start + ' move:' + TDBG.move + ' rot:' + TDBG.rot + ' pinça:' + TDBG.pinchN + '\n' +
        'nTouches:' + TDBG.nT + ' moved:' + TDBG.moved + ' dx:' + (+TDBG.dx).toFixed(1) + '\n' +
        'shooter:' + amShooter() + ' phase:' + phase + ' bih:' + ballInHand + ' ang:' + aimAngle.toFixed(3);
      requestAnimationFrame(upd);
    })();
  }

  requestAnimationFrame(loop);
}
init();
