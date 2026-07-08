/* =========================================================================
   Bilhar Multiplayer — cliente (render + rede + regras do 8-ball)
   A física pesada mora em physics.js (motor event-based). Quem tem a vez
   ("shooter") calcula a tacada INTEIRA de uma vez com Physics.simulateShot()
   e transmite a timeline resultante; o adversário só faz playback dos
   mesmos dados — por isso as duas pontas sempre veem exatamente a mesma
   animação e chegam ao mesmo resultado de regra, sem precisar re-simular.
   Dimensões da mesa (W,H,RAIL,R,POCKET,MOUTH) e MAX_SHOT/STOP_SPEED/POCKETS
   vêm de physics.js (carregado antes deste arquivo).
   ========================================================================= */

'use strict';

const MAXDRAG = 260; // arrasto (px de mundo) para potência máxima

// ---- Cores das bolas -------------------------------------------------------
const SOLID = {
  1: '#f4c430', 2: '#1f5fd0', 3: '#d0322b', 4: '#6a2fa0',
  5: '#e07b18', 6: '#1a8f4a', 7: '#7a1f1f',
};
const colorFor = (n) => (n <= 8 ? (n === 8 ? '#141414' : SOLID[n]) : SOLID[n - 8]);
const isStripe = (n) => n >= 9 && n <= 15;
function groupName(n) {
  if (n === 8) return 'eight';
  if (n >= 1 && n <= 7) return 'solid';
  if (n >= 9 && n <= 15) return 'stripe';
  return null;
}

// ---- Layout inicial (fixo => idêntico nos dois clientes) -------------------
const RACK_NUMBERS = [1, 9, 2, 10, 8, 3, 11, 7, 14, 4, 5, 13, 15, 6, 12];

// ---- Orientação 3D das bolas (para a animação de rolagem) ------------------
// Cada bola tem uma orientação (quatérnion). Ao rolar, giramos a orientação
// em torno do eixo horizontal perpendicular ao movimento por ângulo = dist/R,
// e desenhamos o número / a faixa projetados na superfície da esfera.
const QID = { w: 1, x: 0, y: 0, z: 0 };
function qMul(a, b) {
  return {
    w: a.w * b.w - a.x * b.x - a.y * b.y - a.z * b.z,
    x: a.w * b.x + a.x * b.w + a.y * b.z - a.z * b.y,
    y: a.w * b.y - a.x * b.z + a.y * b.w + a.z * b.x,
    z: a.w * b.z + a.x * b.y - a.y * b.x + a.z * b.w,
  };
}
function qAxisAngle(ax, ay, az, ang) {
  const h = ang / 2, s = Math.sin(h);
  return { w: Math.cos(h), x: ax * s, y: ay * s, z: az * s };
}
function qNorm(q) {
  const m = Math.hypot(q.w, q.x, q.y, q.z) || 1;
  return { w: q.w / m, x: q.x / m, y: q.y / m, z: q.z / m };
}
// Rotaciona o vetor v=[x,y,z] pela orientação q.
function qRotVec(q, v) {
  const tx = 2 * (q.y * v[2] - q.z * v[1]);
  const ty = 2 * (q.z * v[0] - q.x * v[2]);
  const tz = 2 * (q.x * v[1] - q.y * v[0]);
  return [
    v[0] + q.w * tx + (q.y * tz - q.z * ty),
    v[1] + q.w * ty + (q.z * tx - q.x * tz),
    v[2] + q.w * tz + (q.x * ty - q.y * tx),
  ];
}

// ===========================================================================
// Estado global
// ===========================================================================
let balls = [];
let myNo = 0;
let oppName = 'Adversário';
let myName = 'Você';
let currentTurn = 1;
let phase = 'lobby';          // lobby | aim | sim | wait | ended
let ballInHand = false;
let ws = null;

// Tacada calculada de uma vez (event-based) + progresso da animação/playback.
let currentShot = null;   // { duration, segments, events, finalBalls }
let shotElapsed = 0;
let shotQueue = [];       // tacadas recebidas enquanto ainda animo a anterior
let cueOffset = { a: 0, b: 0 }; // efeito escolhido (lateral/vertical), reseta a cada tacada

const game = {
  open: true,                 // mesa aberta (grupos não definidos)
  groups: { 1: null, 2: null }, // 'solid' | 'stripe'
  gameOver: false,
  winner: 0,
  lastMsg: '',
};

// ===========================================================================
// Setup do canvas
// ===========================================================================
const canvas = document.getElementById('table');
const ctx = canvas.getContext('2d');
let scale = 1;
let dpr = 1;

// ---- Imagem da mesa + calibração física→imagem -----------------------------
// A mesa é a imagem `table.png`. A física roda no espaço 900×450 (área de jogo,
// 2:1) e é mapeada sobre a imagem: os centros das caçapas da física (cantos e
// meios da área de jogo) coincidem com os centros das caçapas MEDIDOS na imagem.
const IMG_W = 1240, IMG_H = 713;
// Retângulo do feltro na imagem, em FRAÇÕES (medido na arte) — robusto se a
// resolução da imagem mudar. Os cantos/meios da área de jogo mapeiam aqui.
const FELT = { left: 0.08706, right: 0.90508, top: 0.13249, bottom: 0.84858 };
const CAL = {
  OX: FELT.left * IMG_W,
  OY: FELT.top * IMG_H,
  SX: (FELT.right - FELT.left) * IMG_W / W,
  SY: (FELT.bottom - FELT.top) * IMG_H / H,
};
const tableImg = new Image();
tableImg.src = 'table.png';
tableImg.onload = () => { if (phase !== 'lobby') render(); };

function resize() {
  const wrap = document.getElementById('tableWrap');
  const availW = wrap.clientWidth;
  const availH = wrap.clientHeight;
  scale = Math.min(availW / IMG_W, availH / IMG_H);
  dpr = window.devicePixelRatio || 1;

  const cssW = IMG_W * scale;
  const cssH = IMG_H * scale;
  canvas.style.width = cssW + 'px';
  canvas.style.height = cssH + 'px';
  canvas.width = Math.round(cssW * dpr);
  canvas.height = Math.round(cssH * dpr);
}
window.addEventListener('resize', resize);

// Transform que mapeia coords da FÍSICA (área de jogo) sobre a imagem da mesa.
function applyWorldTransform() {
  ctx.setTransform(dpr * scale * CAL.SX, 0, 0, dpr * scale * CAL.SY,
    dpr * scale * CAL.OX, dpr * scale * CAL.OY);
}

// Converte coords de tela -> coords da física (área de jogo).
function toWorld(clientX, clientY) {
  const rect = canvas.getBoundingClientRect();
  const cx = (clientX - rect.left) / scale;
  const cy = (clientY - rect.top) / scale;
  return { x: (cx - CAL.OX) / CAL.SX, y: (cy - CAL.OY) / CAL.SY };
}

// ===========================================================================
// Criação das bolas
// ===========================================================================
function makeBalls() {
  balls = [];
  const jitter = () => (Math.random() - 0.5) * 0.4; // evita degenerescências no break (§10.1)
  // Bola branca (n=0)
  balls.push({ n: 0, x: W * 0.25, y: H / 2, vx: 0, vy: 0, wx: 0, wy: 0, wz: 0, potted: false, ori: { ...QID } });

  // Triângulo
  const rackX = W * 0.70;
  const rackY = H / 2;
  const gap = 2 * R + 0.4;
  let idx = 0;
  for (let row = 0; row < 5; row++) {
    for (let i = 0; i <= row; i++) {
      const n = RACK_NUMBERS[idx++];
      const x = rackX + row * gap * 0.8660254 + jitter();
      const y = rackY + (i - row / 2) * gap + jitter();
      balls.push({ n, x, y, vx: 0, vy: 0, wx: 0, wy: 0, wz: 0, potted: false, ori: { ...QID } });
    }
  }
}

const ballByN = (n) => balls.find((b) => b.n === n);
const cue = () => ballByN(0);

// ===========================================================================
// Regras do 8-ball
// ===========================================================================
// Converte a lista de eventos do motor de física (contact/pocket/cuepotted)
// no formato que evaluateShot() já esperava.
function deriveRuleEvents(events) {
  let firstContact = null, cuePotted = false;
  const potted = [], pottedOrder = [];
  for (const e of events) {
    if (e.type === 'contact' && firstContact === null && (e.a === 0 || e.b === 0)) {
      firstContact = e.a === 0 ? e.b : e.a;
    }
    if (e.type === 'pocket') { potted.push(e.n); pottedOrder.push(e.n); }
    if (e.type === 'cuepotted') cuePotted = true;
  }
  return { firstContact, cuePotted, potted, pottedOrder };
}

function remainingOfGroup(grp) {
  return balls.filter((b) => !b.potted && groupName(b.n) === grp).length;
}

function evaluateShot(ev) {
  const shooter = currentTurn;
  const opp = shooter === 1 ? 2 : 1;
  let foul = false;
  const reasons = [];

  if (ev.firstContact === null) { foul = true; reasons.push('a branca não tocou em nenhuma bola'); }
  if (ev.cuePotted) { foul = true; reasons.push('a branca caiu (scratch)'); }

  // Legalidade do primeiro contato
  if (ev.firstContact !== null) {
    const fc = groupName(ev.firstContact);
    if (game.open) {
      if (fc === 'eight') { foul = true; reasons.push('acertou a 8 primeiro com a mesa aberta'); }
    } else {
      const myGrp = game.groups[shooter];
      const cleared = remainingOfGroup(myGrp) === 0;
      if (cleared) {
        if (fc !== 'eight') { foul = true; reasons.push('devia acertar a 8 primeiro'); }
      } else if (fc !== myGrp) {
        foul = true; reasons.push('acertou a bola do adversário primeiro');
      }
    }
  }

  const numbered = ev.potted.filter((n) => n !== 8);
  const eightPotted = ev.potted.includes(8);

  // --- Bola 8 encaçapada => fim de jogo ---
  if (eightPotted) {
    const myGrp = game.groups[shooter];
    const clearedNow = myGrp && remainingOfGroup(myGrp) === 0; // 8 já removida; grupo zerado?
    const legal = !foul && !ev.cuePotted && !game.open && clearedNow;
    game.gameOver = true;
    game.winner = legal ? shooter : opp;
    game.lastMsg = legal
      ? `Bola 8 encaçapada! ${playerName(shooter)} venceu! 🏆`
      : `${playerName(shooter)} encaçapou a 8 fora de hora. ${playerName(opp)} venceu!`;
    return { nextTurn: game.winner, ballInHand: false };
  }

  // --- Definição de grupos (mesa aberta) ---
  let continueTurn = false;
  if (!foul && game.open && numbered.length) {
    const first = ev.pottedOrder.find((n) => n !== 8);
    const grp = groupName(first);
    if (grp === 'solid' || grp === 'stripe') {
      game.groups[shooter] = grp;
      game.groups[opp] = grp === 'solid' ? 'stripe' : 'solid';
      game.open = false;
      continueTurn = true;
      game.lastMsg = `${playerName(shooter)} ficou com as ${grp === 'solid' ? 'lisas' : 'listradas'}.`;
    }
  } else if (!foul && !game.open && numbered.length) {
    const myGrp = game.groups[shooter];
    if (numbered.some((n) => groupName(n) === myGrp)) {
      continueTurn = true;
      game.lastMsg = `${playerName(shooter)} encaçapou e continua.`;
    } else {
      game.lastMsg = `${playerName(shooter)} encaçapou bola do adversário. Passa a vez.`;
    }
  }

  let nextTurn, bih = false;
  if (foul) {
    nextTurn = opp;
    bih = true;
    game.lastMsg = `Falta: ${reasons[0]}. ${playerName(opp)} joga com a bola na mão.`;
  } else if (continueTurn) {
    nextTurn = shooter;
  } else {
    nextTurn = opp;
    if (!game.lastMsg) game.lastMsg = `Vez de ${playerName(opp)}.`;
  }
  return { nextTurn, ballInHand: bih };
}

function playerName(no) {
  if (no === myNo) return myName;
  return oppName;
}

// ===========================================================================
// Loop principal — faz playback da timeline pré-calculada (currentShot).
// Tanto quem atirou quanto o espectador só avaliam a mesma forma fechada em
// função do tempo decorrido — não há física para rodar aqui, só leitura.
// ===========================================================================
let last = 0;

function loop(ts) {
  requestAnimationFrame(loop);
  if (phase === 'lobby' || balls.length === 0) { last = ts; return; }

  if (!last) last = ts;
  let frameDt = (ts - last) / 1000;
  last = ts;
  if (frameDt > 0.1) frameDt = 0.1; // trava saltos grandes (aba em 2º plano)

  if (phase === 'sim' && currentShot) {
    shotElapsed = Math.min(shotElapsed + frameDt, currentShot.duration);
    const states = Physics.evaluateShotAt(currentShot.segments, shotElapsed, balls);
    for (let i = 0; i < balls.length; i++) {
      balls[i].x = states[i].x; balls[i].y = states[i].y; balls[i].potted = states[i].potted;
    }
    if (shotElapsed >= currentShot.duration) endShot();
  }
  render();
}

function amShooter() {
  return currentTurn === myNo && !game.gameOver;
}

// ===========================================================================
// Fim da tacada — chamado independentemente por quem atirou e pelo
// espectador, assim que cada um termina de reproduzir a MESMA timeline.
// Como os eventos já vieram prontos (calculados uma única vez por quem
// atirou), o resultado da regra é idêntico dos dois lados sem trocar
// nenhuma mensagem extra.
// ===========================================================================
// Inicia a reprodução de uma tacada (própria ou recebida).
function startPlayback(shot) {
  // Blindagem anti-travamento: duração SEMPRE finita e razoável, senão a
  // animação nunca terminaria (ficaria presa em 'sim' nos dois lados).
  if (!shot || !isFinite(shot.duration) || shot.duration < 0) {
    shot = shot || { duration: 0, segments: balls.map(() => []), events: [], finalBalls: balls.map((b) => ({ n: b.n, x: b.x, y: b.y, potted: b.potted })) };
    shot.duration = 0;
  }
  shot.duration = Math.min(shot.duration, 30);
  currentShot = shot;
  shotElapsed = 0;
  phase = 'sim';
  oppAim = null;
  updateHUD();
}

function endShot() {
  const shot = currentShot;
  currentShot = null;

  // Encosta nas posições finais autoritativas (elimina qualquer resíduo
  // numérico do playback quadro-a-quadro).
  for (const fb of shot.finalBalls) {
    const b = ballByN(fb.n);
    if (b) { b.x = fb.x; b.y = fb.y; b.potted = fb.potted; b.vx = 0; b.vy = 0; b.wx = 0; b.wy = 0; b.wz = 0; }
  }

  const result = evaluateShot(deriveRuleEvents(shot.events));
  currentTurn = result.nextTurn;
  ballInHand = result.ballInHand;

  // Reposiciona a branca se caiu
  if (cue().potted) {
    const c = cue();
    c.potted = false;
    c.x = W * 0.25; c.y = H / 2; c.vx = 0; c.vy = 0; c.wx = 0; c.wy = 0; c.wz = 0;
  }

  if (game.gameOver) { shotQueue = []; showEnd(); return; }

  // Se chegaram tacadas enquanto eu animava esta, reproduzo a próxima na ordem
  // (garante que cada tacada passe pelo seu endShot e mantenha a vez em sincronia).
  if (shotQueue.length > 0) { startPlayback(shotQueue.shift()); return; }

  phase = currentTurn === myNo ? 'aim' : 'wait';
  updateHUD();
}

// ===========================================================================
// Rede
// ===========================================================================
function connect() {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  ws = new WebSocket(`${proto}://${location.host}`);
  ws.onopen = () => {
    send({ t: 'join', room: roomInput, name: myName });
  };
  ws.onmessage = (e) => {
    let msg;
    try { msg = JSON.parse(e.data); } catch (_) { return; }
    handleNet(msg);
  };
  ws.onclose = () => {
    setLobbyMsg('Conexão encerrada. Recarregue a página.');
  };
}

function send(obj) {
  if (ws && ws.readyState === 1) ws.send(JSON.stringify(obj));
}

function handleNet(msg) {
  switch (msg.t) {
    case 'joined':
      myNo = msg.playerNo;
      setLobbyMsg(`Entrou como Jogador ${myNo}. ${myNo === 1 ? 'Aguardando adversário...' : ''}`);
      break;
    case 'waiting':
      setLobbyMsg('Aguardando o segundo jogador entrar na sala...');
      break;
    case 'full':
      setLobbyMsg('Sala cheia! Tente outro nome de sala.');
      break;
    case 'start':
      oppName = msg.opponent || 'Adversário';
      currentTurn = msg.startTurn;
      startGame();
      break;
    case 'shot': {
      // Recebe a timeline inteira já calculada por quem atirou; só reproduz.
      const shot = { duration: msg.duration, segments: msg.segments, events: msg.events, finalBalls: msg.finalBalls };
      // Se AINDA estou animando a tacada anterior (o adversário potou e jogou de
      // novo antes de eu terminar a animação), NÃO posso sobrescrever a tacada
      // atual — senão eu pularia o endShot dela e perderia a atualização de
      // regras/posições, dessincronizando a vez entre os dois lados (deadlock).
      // Enfileiro e reproduzo em ordem quando a atual terminar.
      if (phase === 'sim' && currentShot) {
        shotQueue.push(shot);
      } else {
        startPlayback(shot);
      }
      break;
    }
    case 'aim':
      // Espelha a mira do adversário
      oppAim = msg.a;
      break;
    case 'peer_left':
      if (!game.gameOver) setStatus('Adversário saiu da sala.');
      break;
    case 'rematch':
      doRematch(false);
      break;
  }
}

// ===========================================================================
// Entrada (mira / tacada / efeito / bola na mão)
// ===========================================================================
let aiming = false;
let aimStart = null;   // ponto onde o ponteiro desceu
let aimCur = null;
let oppAim = null;
let lastAimSent = 0;

function pointerDown(e) {
  if (!amShooter() || phase !== 'aim') return;
  const p = toWorld(e.clientX ?? e.touches[0].clientX, e.clientY ?? e.touches[0].clientY);

  if (ballInHand) {
    // Posiciona a branca em local válido
    if (placeCue(p.x, p.y)) {
      ballInHand = false;
      setStatus('Bola posicionada. Sua vez de mirar.');
    }
    return;
  }

  aiming = true;
  aimStart = p;
  aimCur = p;
  document.getElementById('powerbar').classList.add('show');
}

function pointerMove(e) {
  if (ballInHand && amShooter() && phase === 'aim') {
    const p = toWorld(e.clientX ?? e.touches[0].clientX, e.clientY ?? e.touches[0].clientY);
    ghostCue = clampCue(p.x, p.y);
    return;
  }
  if (!aiming) return;
  aimCur = toWorld(e.clientX ?? e.touches[0].clientX, e.clientY ?? e.touches[0].clientY);

  // Atualiza barra de potência
  const c = cue();
  const d = Math.min(Math.hypot(aimCur.x - c.x, aimCur.y - c.y), MAXDRAG);
  const pow = d / MAXDRAG;
  document.getElementById('powerfill').style.width = (pow * 100) + '%';

  // Transmite mira (throttle) para o adversário ver o taco
  const now = performance.now();
  if (now - lastAimSent > 60) {
    lastAimSent = now;
    const ang = Math.atan2(c.y - aimCur.y, c.x - aimCur.x);
    send({ t: 'aim', a: { ang, pow } });
  }
}

function pointerUp() {
  if (!aiming) return;
  aiming = false;
  document.getElementById('powerbar').classList.remove('show');

  const c = cue();
  const dx = c.x - aimCur.x;
  const dy = c.y - aimCur.y;
  const d = Math.hypot(dx, dy);
  if (d < 6) return; // clique curto, ignora
  const dir = { x: dx / d, y: dy / d };
  const power = Math.min(d, MAXDRAG) / MAXDRAG;

  let strike = Physics.cueStrike(power, dir, cueOffset.a, cueOffset.b);
  if (strike.miscue) {
    // Tacada falhou (efeito além do limite físico, §5.1/§10.6): sai bem fraca e sem efeito.
    strike = { vx: dir.x * power * MAX_SHOT * 0.15, vy: dir.y * power * MAX_SHOT * 0.15, wx: 0, wy: 0, wz: 0 };
    game.lastMsg = 'Miscue! Tacada saiu fraca e sem efeito.';
  }
  c.vx = strike.vx; c.vy = strike.vy; c.wx = strike.wx; c.wy = strike.wy; c.wz = strike.wz;
  cueOffset = { a: 0, b: 0 };

  const snapshot = balls.map((b) => ({ n: b.n, x: b.x, y: b.y, vx: b.vx, vy: b.vy, wx: b.wx, wy: b.wy, wz: b.wz, potted: b.potted }));
  const shot = Physics.simulateShot(snapshot);
  send({ t: 'shot', segments: shot.segments, duration: shot.duration, events: shot.events, finalBalls: shot.finalBalls });
  startPlayback(shot); // mesmo guard de duração finita do lado que recebe
  updateHUD();
}

// Bola na mão: valida e coloca a branca
function clampCue(x, y) {
  x = Math.max(R + 1, Math.min(W - R - 1, x));
  y = Math.max(R + 1, Math.min(H - R - 1, y));
  return { x, y };
}
function overlapsAny(x, y) {
  return balls.some((b) => b.n !== 0 && !b.potted && Math.hypot(b.x - x, b.y - y) < 2 * R + 1);
}
function placeCue(x, y) {
  const p = clampCue(x, y);
  if (overlapsAny(p.x, p.y)) return false;
  const c = cue();
  c.x = p.x; c.y = p.y; c.vx = 0; c.vy = 0; c.wx = 0; c.wy = 0; c.wz = 0; c.potted = false;
  ghostCue = null;
  return true;
}
let ghostCue = null;

// ---- Controle de efeito (mini bola clicável: offset a=lateral, b=vertical) --
const englishPicker = document.getElementById('englishPicker');
const englishDot = document.getElementById('englishDot');
let pickingEnglish = false;

function setEnglishFromEvent(e) {
  const rect = englishPicker.getBoundingClientRect();
  const cx = rect.left + rect.width / 2, cy = rect.top + rect.height / 2;
  const clientX = e.clientX ?? e.touches[0].clientX;
  const clientY = e.clientY ?? e.touches[0].clientY;
  let dx = (clientX - cx) / (rect.width / 2);
  let dy = (clientY - cy) / (rect.height / 2);
  const mag = Math.hypot(dx, dy);
  if (mag > 1) { dx /= mag; dy /= mag; }
  cueOffset = { a: dx * Physics.MAX_OFFSET, b: -dy * Physics.MAX_OFFSET }; // tela: y cresce p/ baixo; b>0 = acima do centro
  englishDot.style.left = (50 + dx * 45) + '%';
  englishDot.style.top = (50 + dy * 45) + '%';
}

englishPicker.addEventListener('mousedown', (e) => {
  if (!amShooter() || phase !== 'aim') return;
  pickingEnglish = true;
  setEnglishFromEvent(e);
});
window.addEventListener('mousemove', (e) => { if (pickingEnglish) setEnglishFromEvent(e); });
window.addEventListener('mouseup', () => { pickingEnglish = false; });
englishPicker.addEventListener('touchstart', (e) => {
  if (!amShooter() || phase !== 'aim') return;
  e.preventDefault(); e.stopPropagation();
  pickingEnglish = true;
  setEnglishFromEvent(e);
}, { passive: false });
englishPicker.addEventListener('touchmove', (e) => {
  if (!pickingEnglish) return;
  e.preventDefault(); e.stopPropagation();
  setEnglishFromEvent(e);
}, { passive: false });
englishPicker.addEventListener('touchend', (e) => { e.stopPropagation(); pickingEnglish = false; });

// ===========================================================================
// Previsão da linha de mira
// ===========================================================================
function predict(dir) {
  const c = cue();
  const step = 3;
  let x = c.x, y = c.y;
  for (let i = 0; i < 800; i++) {
    x += dir.x * step;
    y += dir.y * step;
    // Colisão com bola
    for (const b of balls) {
      if (b.n === 0 || b.potted) continue;
      if (Math.hypot(b.x - x, b.y - y) < 2 * R) {
        return { hit: { x, y }, ball: b, wall: false };
      }
    }
    // Entrando numa caçapa? (o centro chega ao círculo de captura)
    for (const p of Physics.TABLE.pockets) {
      if (Math.hypot(p.x - x, p.y - y) < p.cap) {
        return { hit: { x: p.x, y: p.y }, ball: null, wall: false, pocket: true };
      }
    }
    // Paredes (aproximação: retângulo de jogo; a boca da caçapa é tratada acima)
    if (x < R || x > W - R || y < R || y > H - R) {
      return { hit: { x: Math.max(R, Math.min(W - R, x)), y: Math.max(R, Math.min(H - R, y)) }, ball: null, wall: true };
    }
  }
  return { hit: { x, y }, ball: null, wall: false };
}

// ===========================================================================
// Renderização
// ===========================================================================
function render() {
  // Fundo da mesa = imagem (desenhada em coords da imagem).
  ctx.setTransform(dpr * scale, 0, 0, dpr * scale, 0, 0);
  if (tableImg.complete && tableImg.naturalWidth) {
    ctx.drawImage(tableImg, 0, 0, IMG_W, IMG_H);
  } else {
    ctx.fillStyle = '#0a3d24';
    ctx.fillRect(0, 0, IMG_W, IMG_H);
  }

  // Daqui em diante desenhamos em coords da FÍSICA, mapeadas sobre a imagem.
  applyWorldTransform();

  // Linha de mira / taco
  drawAim();

  // Fantasma da branca (bola na mão)
  if (ballInHand && ghostCue && amShooter()) {
    ctx.beginPath();
    ctx.arc(ghostCue.x, ghostCue.y, R, 0, Math.PI * 2);
    ctx.fillStyle = overlapsAny(ghostCue.x, ghostCue.y) ? 'rgba(220,80,80,0.5)' : 'rgba(255,255,255,0.5)';
    ctx.fill();
  }

  // Bolas — integra a rolagem (gira a orientação conforme a bola andou) e desenha.
  for (const b of balls) {
    if (b.potted) continue;
    if (b._px === undefined) { b._px = b.x; b._py = b.y; }
    const dx = b.x - b._px, dy = b.y - b._py;
    const dist = Math.hypot(dx, dy);
    let moved = false;
    if (dist > 0.02 && dist < 5 * R) { // ignora teleportes (bola na mão/reset)
      const ang = dist / R;                 // rolamento puro: giro = distância / raio
      const ax = -dy / dist, ay = dx / dist; // eixo horizontal ⟂ ao movimento (topo rola no sentido do movimento)
      b.ori = qNorm(qMul(qAxisAngle(ax, ay, 0, ang), b.ori || QID));
      moved = true;
    }
    b._moved = moved;
    b._px = b.x; b._py = b.y;
    drawBall(b);
  }

  ctx.setTransform(dpr * scale, 0, 0, dpr * scale, 0, 0);
}

function drawAim() {
  const c = cue();
  if (!c || c.potted) return;

  // Direção: minha mira ou a do adversário (espelhada)
  let dir = null, power = 0;
  if (amShooter() && phase === 'aim' && aiming && aimCur) {
    const dx = c.x - aimCur.x, dy = c.y - aimCur.y;
    const d = Math.hypot(dx, dy);
    if (d > 1) { dir = { x: dx / d, y: dy / d }; power = Math.min(d, MAXDRAG) / MAXDRAG; }
  } else if (!amShooter() && oppAim) {
    dir = { x: Math.cos(oppAim.ang), y: Math.sin(oppAim.ang) };
    power = oppAim.pow;
  }
  if (!dir) return;

  // A linha prevista segue a direção real de saída da branca (com squirt,
  // se houver efeito lateral aplicado) — só sabemos o nosso próprio efeito.
  const shootDir = amShooter() ? Physics.squirtedDir(dir, cueOffset.a) : dir;
  const pred = predict(shootDir);

  // Linha pontilhada de mira
  ctx.save();
  ctx.setLineDash([8, 8]);
  ctx.strokeStyle = 'rgba(255,255,255,0.6)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(c.x, c.y);
  ctx.lineTo(pred.hit.x, pred.hit.y);
  ctx.stroke();
  ctx.setLineDash([]);

  // Fantasma no ponto de contato + direção da bola alvo
  if (pred.ball) {
    ctx.beginPath();
    ctx.arc(pred.hit.x, pred.hit.y, R, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(255,255,255,0.8)';
    ctx.lineWidth = 1.5;
    ctx.stroke();
    const tdx = pred.ball.x - pred.hit.x, tdy = pred.ball.y - pred.hit.y;
    const td = Math.hypot(tdx, tdy) || 1;
    ctx.beginPath();
    ctx.moveTo(pred.ball.x, pred.ball.y);
    ctx.lineTo(pred.ball.x + (tdx / td) * 60, pred.ball.y + (tdy / td) * 60);
    ctx.strokeStyle = 'rgba(255,220,120,0.7)';
    ctx.stroke();
  }
  ctx.restore();

  // Taco: fica ATRÁS da branca (lado oposto ao da tacada) e recua com a potência
  const back = 18 + power * 60;
  const len = 260;
  const bx = c.x - dir.x * back, by = c.y - dir.y * back; // ponta do taco, junto da bola
  ctx.beginPath();
  ctx.moveTo(bx, by);
  ctx.lineTo(bx - dir.x * len, by - dir.y * len);
  ctx.strokeStyle = '#c9a227';
  ctx.lineWidth = 5;
  ctx.lineCap = 'round';
  ctx.stroke();
  // Ponteira clara na extremidade que toca a bola
  ctx.beginPath();
  ctx.moveTo(bx, by);
  ctx.lineTo(bx - dir.x * 12, by - dir.y * 12);
  ctx.strokeStyle = '#eaeaea';
  ctx.lineWidth = 5;
  ctx.stroke();
}

// ---- Renderizador de esfera por pixel (para a rolagem das bolas) -----------
const SPH_N = 64;
const _sphCanvas = document.createElement('canvas');
_sphCanvas.width = SPH_N; _sphCanvas.height = SPH_N;
const _sphCtx = _sphCanvas.getContext('2d');
const _sphImg = _sphCtx.createImageData(SPH_N, SPH_N);
const LIGHT = (() => { const v = [-0.35, -0.42, 0.84]; const m = Math.hypot(...v); return [v[0] / m, v[1] / m, v[2] / m]; })();

function hexRGB(hex) {
  return [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)];
}

// Desenha a textura da esfera (cor + faixa) girada pela orientação, com
// sombreamento. A faixa é a região |localY| < BAND (equador do eixo Y local);
// fora disso é branco (as "pontas" brancas da listrada). Lisas: cor inteira.
const BAND = 0.55;
function renderSphere(target, ori, rgb, stripe) {
  const d = _sphImg.data, N = SPH_N, c = (N - 1) / 2;
  const q = { w: ori.w, x: -ori.x, y: -ori.y, z: -ori.z }; // conjugado (mundo→local)
  for (let py = 0; py < N; py++) {
    for (let px = 0; px < N; px++) {
      const i = (py * N + px) * 4;
      const nx = (px - c) / (c - 0.5), ny = (py - c) / (c - 0.5);
      const r2 = nx * nx + ny * ny;
      if (r2 > 1) { d[i + 3] = 0; continue; }
      const nz = Math.sqrt(1 - r2);
      const lp = qRotVec(q, [nx, ny, nz]);
      let cr, cg, cb;
      if (stripe && Math.abs(lp[1]) > BAND) { cr = 246; cg = 246; cb = 240; }
      else { cr = rgb[0]; cg = rgb[1]; cb = rgb[2]; }
      let sh = 0.5 + 0.6 * (nx * LIGHT[0] + ny * LIGHT[1] + nz * LIGHT[2]);
      if (sh < 0.3) sh = 0.3; else if (sh > 1.25) sh = 1.25;
      d[i] = Math.min(255, cr * sh);
      d[i + 1] = Math.min(255, cg * sh);
      d[i + 2] = Math.min(255, cb * sh);
      d[i + 3] = 255;
    }
  }
  target.getContext('2d').putImageData(_sphImg, 0, 0);
}

function drawBall(b) {
  const cx = b.x, cy = b.y;
  const stripe = isStripe(b.n);
  const rgb = b.n === 0 ? [246, 246, 240] : hexRGB(colorFor(b.n));
  const ori = b.ori || QID;
  const pole = qRotVec(ori, [0, 0, 1]);   // eixo do número
  const anti = [-pole[0], -pole[1], -pole[2]];

  // Sombra
  ctx.beginPath();
  ctx.ellipse(cx + 2, cy + 3, R, R * 0.85, 0, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(0,0,0,0.28)';
  ctx.fill();

  // Corpo: esfera texturizada (cor/faixa girada + sombreamento). Só re-renderiza
  // a textura quando a bola girou neste frame (cache por bola → performance).
  if (!b._tex) { b._tex = document.createElement('canvas'); b._tex.width = b._tex.height = SPH_N; b._texValid = false; }
  if (b._moved || !b._texValid) { renderSphere(b._tex, ori, rgb, stripe); b._texValid = true; }
  ctx.save();
  ctx.imageSmoothingEnabled = true;
  ctx.beginPath();
  ctx.arc(cx, cy, R, 0, Math.PI * 2);
  ctx.clip();
  ctx.drawImage(b._tex, cx - R, cy - R, 2 * R, 2 * R);

  // Número (lisas e listradas) / ponto vermelho (branca), nos dois polos do
  // eixo do número, com crossfade suave ao virar para trás.
  const fade = (z) => Math.max(0, Math.min(1, (z + 0.05) / 0.35));
  const drawMark = (u) => {
    const a = fade(u[2]);
    if (a <= 0.01) return;
    const zc = Math.max(0, u[2]);
    const px = cx + u[0] * R * 0.6, py = cy + u[1] * R * 0.6;
    ctx.globalAlpha = a;
    if (b.n === 0) {
      ctx.beginPath();
      ctx.arc(px, py, R * 0.15 * (0.4 + 0.6 * zc), 0, Math.PI * 2);
      ctx.fillStyle = '#d23b3b';
      ctx.fill();
    } else {
      const cr = R * 0.34 * (0.5 + 0.5 * zc);
      ctx.beginPath();
      ctx.arc(px, py, cr, 0, Math.PI * 2);
      ctx.fillStyle = '#fff';
      ctx.fill();
      if (cr > R * 0.17) {
        ctx.fillStyle = '#111';
        ctx.font = `bold ${cr * 1.15}px system-ui, sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(String(b.n), px, py + cr * 0.05);
      }
    }
    ctx.globalAlpha = 1;
  };
  drawMark(pole); drawMark(anti);
  ctx.restore();

  // Brilho especular sutil.
  const g = ctx.createRadialGradient(cx - R * 0.4, cy - R * 0.42, 1, cx - R * 0.1, cy - R * 0.1, R * 1.1);
  g.addColorStop(0, 'rgba(255,255,255,0.45)');
  g.addColorStop(0.25, 'rgba(255,255,255,0.05)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.beginPath();
  ctx.arc(cx, cy, R, 0, Math.PI * 2);
  ctx.fillStyle = g;
  ctx.fill();
}

function roundRect(x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

// ===========================================================================
// HUD
// ===========================================================================
function setStatus(txt) { document.getElementById('status').textContent = txt; }

function updateHUD() {
  const p1 = document.getElementById('p1');
  const p2 = document.getElementById('p2');
  const n1 = myNo === 1 ? myName : oppName;
  const n2 = myNo === 1 ? oppName : myName;
  p1.querySelector('.pname').textContent = n1 + (myNo === 1 ? ' (você)' : '');
  p2.querySelector('.pname').textContent = n2 + (myNo === 2 ? ' (você)' : '');

  p1.classList.toggle('active', currentTurn === 1);
  p2.classList.toggle('active', currentTurn === 2);

  document.getElementById('p1group').textContent = groupLabel(game.groups[1]);
  document.getElementById('p2group').textContent = groupLabel(game.groups[2]);
  document.getElementById('p1balls').textContent = ballsLeftLabel(1);
  document.getElementById('p2balls').textContent = ballsLeftLabel(2);

  englishPicker.classList.toggle('show', amShooter() && phase === 'aim' && !ballInHand);

  let s;
  if (game.gameOver) s = game.lastMsg;
  else if (currentTurn === myNo) s = ballInHand ? 'Bola na mão — toque para posicionar a branca.' : 'Sua vez! Mire e dê a tacada.';
  else s = `Vez de ${oppName}...`;
  if (game.lastMsg && !game.gameOver) s = game.lastMsg + (currentTurn === myNo ? ' Sua vez!' : '');
  setStatus(s);
}

function groupLabel(g) {
  if (!g) return 'mesa aberta';
  return g === 'solid' ? '● lisas (1–7)' : '◐ listradas (9–15)';
}
function ballsLeftLabel(no) {
  const g = game.groups[no];
  if (!g) return '';
  const n = remainingOfGroup(g);
  return `restam ${n}`;
}

// ===========================================================================
// Lobby / início
// ===========================================================================
let roomInput = 'sala1';

function setLobbyMsg(t) { document.getElementById('lobbyMsg').textContent = t; }

function startGame() {
  document.getElementById('lobby').classList.add('hidden');
  document.getElementById('endOverlay').classList.add('hidden');
  document.getElementById('game').classList.remove('hidden');
  makeBalls();
  game.open = true;
  game.groups = { 1: null, 2: null };
  game.gameOver = false;
  game.winner = 0;
  game.lastMsg = '';
  ballInHand = false;
  cueOffset = { a: 0, b: 0 };
  currentShot = null;
  shotQueue = [];
  phase = currentTurn === myNo ? 'aim' : 'wait';
  resize();
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

function doRematch(initiator) {
  // Player 1 sempre reinicia como quem começa
  currentTurn = 1;
  if (initiator) send({ t: 'rematch' });
  startGame();
}

// ===========================================================================
// Bind de eventos
// ===========================================================================
document.getElementById('joinBtn').addEventListener('click', () => {
  myName = (document.getElementById('name').value || 'Jogador').trim().slice(0, 20);
  roomInput = (document.getElementById('room').value || 'sala1').trim().slice(0, 24);
  setLobbyMsg('Conectando...');
  connect();
});

document.getElementById('rematchBtn').addEventListener('click', () => {
  document.getElementById('rematchMsg').textContent = 'Aguardando o adversário...';
  doRematch(true);
});

// Ponteiro (mouse + touch)
canvas.addEventListener('mousedown', pointerDown);
window.addEventListener('mousemove', pointerMove);
window.addEventListener('mouseup', pointerUp);
canvas.addEventListener('touchstart', (e) => { e.preventDefault(); pointerDown(e); }, { passive: false });
canvas.addEventListener('touchmove', (e) => { e.preventDefault(); pointerMove(e); }, { passive: false });
canvas.addEventListener('touchend', (e) => { e.preventDefault(); pointerUp(e); }, { passive: false });

// Pré-preenche campos
document.getElementById('name').value = '';
document.getElementById('room').value = 'sala1';

requestAnimationFrame(loop);
