/* =========================================================================
   Teste de integração: 2 clientes WS entram na fila, são pareados e jogam
   uma partida REAL contra o servidor autoritativo (wrangler dev na :8787).
   Estratégia dos bots: derrubar a bola 8 o quanto antes (ghost ball) —
   qualquer queda da 8 encerra a partida (legal = vitória; ilegal = derrota
   do atirador), o que valida o ciclo completo: fila → sala → física →
   regras → ELO no D1 → leaderboard.
   Uso: npm run db:local && (npm run dev &) && npm test
   ========================================================================= */
'use strict';

const BASE = process.env.RANKED_URL || 'http://127.0.0.1:8787';
const WS = BASE.replace('http', 'ws');
const devToken = (id, name) =>
  'dev.' + Buffer.from(JSON.stringify({ id, name })).toString('base64url');

const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);
const openSockets = [];
const fail = (msg) => {
  console.error('FAIL -', msg);
  for (const s of openSockets) { try { s.close(1000, 'fail'); } catch (e) {} } // RST derruba o workerd local
  setTimeout(() => process.exit(1), 300);
};
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

// Dimensões (iguais ao engine — mantidas em sincronia manual só p/ o teste)
const W = 850.4, H = 421.4, R = 9.8;
const POCKETS = [
  { x: 0, y: 0 }, { x: W / 2, y: 0 }, { x: W, y: 0 },
  { x: 0, y: H }, { x: W / 2, y: H }, { x: W, y: H },
];

class Player {
  constructor(id, name) {
    this.id = id; this.name = name; this.token = devToken(id, name);
    this.no = 0; this.balls = []; this.state = null; this.result = null;
    this.queue = []; this.waiters = [];
  }
  push(m) { const w = this.waiters.shift(); if (w) w(m); else this.queue.push(m); }
  next(timeout = 30000) {
    if (this.queue.length) return Promise.resolve(this.queue.shift());
    return new Promise((res, rej) => {
      const t = setTimeout(() => rej(new Error(this.name + ': timeout esperando mensagem')), timeout);
      this.waiters.push((m) => { clearTimeout(t); res(m); });
    });
  }
  connect(path) {
    return new Promise((res, rej) => {
      const ws = new WebSocket(`${WS}${path}?token=${this.token}`);
      ws.onopen = () => res(ws);
      ws.onerror = (e) => rej(new Error(this.name + ': erro WS ' + path));
      ws.onmessage = (ev) => this.push(JSON.parse(ev.data));
      openSockets.push(ws);
    });
  }
  send(obj) { this.ws.send(JSON.stringify(obj)); }
  applyShot(m) {
    for (const fb of m.finalBalls) {
      const b = this.balls.find((x) => x.n === fb.n);
      if (b) { b.x = fb.x; b.y = fb.y; b.potted = fb.potted; }
    }
    const cue = this.balls.find((b) => b.n === 0);
    if (cue.potted) { cue.potted = false; cue.x = W * 0.25; cue.y = H / 2; }
    this.state = m.state;
  }
  // Mira ghost-ball na bola 8 → caçapa mais próxima da 8.
  aimAtEight() {
    const cue = this.balls.find((b) => b.n === 0);
    const b8 = this.balls.find((b) => b.n === 8);
    const pocket = POCKETS.reduce((best, p) => (dist(p, b8) < dist(best, b8) ? p : best));
    const u = { x: (b8.x - pocket.x) / dist(b8, pocket), y: (b8.y - pocket.y) / dist(b8, pocket) };
    const ghost = { x: b8.x + 2 * R * u.x, y: b8.y + 2 * R * u.y };
    return { ang: Math.atan2(ghost.y - cue.y, ghost.x - cue.x), pocket, u, b8 };
  }
  placeForEight() { // bola na mão: coloca a branca atrás da linha 8→caçapa
    const { u, b8 } = this.aimAtEight();
    for (let d = 6; d <= 30; d += 4) {
      const x = Math.max(R + 2, Math.min(W - R - 2, b8.x + d * R * u.x));
      const y = Math.max(R + 2, Math.min(H - R - 2, b8.y + d * R * u.y));
      if (!this.balls.some((b) => b.n !== 0 && !b.potted && Math.hypot(b.x - x, b.y - y) < 2 * R + 2)) {
        const cue = this.balls.find((b) => b.n === 0);
        cue.x = x; cue.y = y; cue.potted = false;
        this.send({ t: 'ballcue', x, y });
        return;
      }
    }
  }
}

async function main() {
  const p1 = new Player('teste-alice', 'Alice');
  const p2 = new Player('teste-bruno', 'Bruno');

  // ---- fila -----------------------------------------------------------
  const qws = {};
  for (const p of [p1, p2]) { qws[p.name] = await p.connect('/ws/queue'); log(p.name, 'na fila'); }
  for (const p of [p1, p2]) {
    let m;
    do { m = await p.next(); } while (m.t !== 'matched');
    p.room = m.room; p.no = m.playerNo;
    log(p.name, '→ sala', m.room.slice(0, 8), 'como jogador', p.no);
    try { qws[p.name].close(1000, 'pareado'); } catch (e) {}
  }
  if (p1.room !== p2.room) fail('salas diferentes');

  // ---- sala -----------------------------------------------------------
  for (const p of [p1, p2]) p.ws = await p.connect('/ws/room/' + p.room);
  for (const p of [p1, p2]) {
    let m;
    do { m = await p.next(); } while (m.t !== 'start');
    p.balls = m.balls.map((b) => ({ ...b }));
    p.state = { currentTurn: m.startTurn, ballInHand: false, gameOver: false };
    log(p.name, 'start ok — elo', JSON.stringify(m.elo));
  }

  // ---- joga até a 8 cair ----------------------------------------------
  const byNo = { [p1.no]: p1, [p2.no]: p2 };
  // Tacada 1: break do jogador 1 (reto, força máxima)
  byNo[1].send({ t: 'shotinput', ang: 0, power: 1, a: 0, b: 0 });
  log('break!');

  for (let shots = 1; shots < 80; shots++) {
    // Ambos recebem o mesmo 'shot'; processa nos dois espelhos.
    let m1;
    do { m1 = await p1.next(); } while (!['shot', 'ranked_result'].includes(m1.t));
    if (m1.t === 'ranked_result') { p1.result = m1; break; }
    let m2;
    do { m2 = await p2.next(); } while (!['shot', 'ranked_result'].includes(m2.t));
    p1.applyShot(m1); p2.applyShot(m2);
    if (m1.state.gameOver) {
      let r1; do { r1 = await p1.next(); } while (r1.t !== 'ranked_result');
      p1.result = r1;
      let r2; do { r2 = await p2.next(); } while (r2.t !== 'ranked_result');
      p2.result = r2;
      break;
    }
    const shooter = byNo[m1.state.currentTurn];
    if (m1.state.ballInHand) shooter.placeForEight();
    const { ang } = shooter.aimAtEight();
    shooter.send({ t: 'shotinput', ang, power: 0.85, a: 0, b: 0 });
    if (shots % 5 === 0) log('tacada', shots, '— vez do jogador', m1.state.currentTurn);
  }

  if (!p1.result) fail('partida não terminou em 80 tacadas');
  log('fim de jogo! vencedor: jogador', p1.result.winner, '| motivo:', p1.result.reason, '| elo:', JSON.stringify(p1.result.elo));
  if (!p1.result.elo || typeof p1.result.elo.delta !== 'number') fail('ELO não veio no resultado');

  // ---- leaderboard ------------------------------------------------------
  const lb = await (await fetch(BASE + '/api/leaderboard')).json();
  log('leaderboard', lb.season + ':', lb.players.map((p) => `${p.name} ${p.elo.toFixed(0)} (${p.wins}V/${p.losses}D)`).join(' | '));
  const names = lb.players.map((p) => p.name);
  if (!names.includes('Alice') || !names.includes('Bruno')) fail('jogadores fora do leaderboard');
  const winner = lb.players.find((p) => p.wins >= 1);
  if (!winner || winner.elo <= 1000) fail('ELO do vencedor não subiu');

  console.log('\nPASS - ciclo completo: fila → pareamento → física/regras no servidor → ELO → leaderboard');
  for (const p of [p1, p2]) { try { p.ws.close(1000, 'fim'); } catch (e) {} } // close limpo: RST derruba o workerd local
  setTimeout(() => process.exit(0), 400);
}

main().catch((e) => fail(e.message));
