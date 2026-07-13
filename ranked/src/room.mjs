/* =========================================================================
   RankedRoom — Durable Object AUTORITATIVO de uma partida ranqueada 1v1.
   O cliente envia só o INPUT da tacada (ângulo/força/efeito); o DO roda o
   MESMO physics.js + rules.js do jogo (engine.mjs) e transmite a timeline
   pronta aos dois lados. Nenhum cliente reporta resultado — o vencedor
   nasce aqui e o ELO é gravado no D1 por este código.

   Protocolo (espelha o P2P do cliente onde possível):
     ← joined/waiting/start/shot/resync/peer_left/rejoined
     ← ranked_result { winner, deltas } (fim de partida)
     → shotinput { ang, power, a, b } | ballcue { x, y } | aim { a }
   Hibernação: estado em storage ('g'); identidade nos attachments dos WS.
   Timeouts (alarm): 90s por tacada; 60s de tolerância p/ reconexão.
   ========================================================================= */
'use strict';

import { Physics, W, H, R, MAX_SHOT, Rules } from './engine.mjs';
import { recordResult, getElo } from './elo.mjs';

const TURN_MS = 90_000;      // tempo máximo por tacada
const RECONNECT_MS = 60_000; // tolerância de queda de conexão
const teamOf = (no) => no;   // 1v1: time == jogador

function makeBalls() {
  const balls = [];
  const jitter = () => (Math.random() - 0.5) * 0.4;
  balls.push({ n: 0, x: W * 0.25, y: H / 2, vx: 0, vy: 0, wx: 0, wy: 0, wz: 0, potted: false });
  const rackX = W * 0.70, rackY = H / 2, gap = 2 * R + 0.4; let idx = 0;
  for (let row = 0; row < 5; row++) for (let i = 0; i <= row; i++) {
    const n = Rules.RACK_NUMBERS[idx++];
    balls.push({ n, x: rackX + row * gap * 0.8660254 + jitter(), y: rackY + (i - row / 2) * gap + jitter(), vx: 0, vy: 0, wx: 0, wy: 0, wz: 0, potted: false });
  }
  return balls;
}

export class RankedRoom {
  constructor(state, env) {
    this.state = state;
    this.env = env;
    this.g = null; // estado da partida (lazy: storage 'g')
  }

  async load() {
    if (!this.g) this.g = (await this.state.storage.get('g')) || null;
    return this.g;
  }
  async save() { await this.state.storage.put('g', this.g); }

  sockets(no) {
    return this.state.getWebSockets(no ? 'p' + no : undefined);
  }
  sendTo(no, obj) { for (const ws of this.sockets(no)) { try { ws.send(JSON.stringify(obj)); } catch (e) {} } }
  broadcast(obj) { this.sendTo(null, obj); }

  // ---------------------------------------------------------------- fetch
  async fetch(request) {
    const url = new URL(request.url);

    // Interno (fila → sala): define os 2 jogadores esperados.
    if (url.pathname === '/prepare' && request.method === 'POST') {
      const { players } = await request.json(); // [{id,name},{id,name}]
      this.g = {
        expect: players, players: {}, started: false, finished: false,
        balls: null, currentTurn: 1, open: true, groups: { 1: null, 2: null },
        ballInHand: false, gameOver: false, winner: 0,
        deadline: Date.now() + RECONNECT_MS, deadlineKind: 'join',
      };
      await this.save();
      await this.state.storage.setAlarm(this.g.deadline);
      return new Response('ok');
    }

    // Conexão WebSocket de um jogador (identidade verificada pelo Worker).
    if (url.pathname === '/ws') {
      if (request.headers.get('Upgrade') !== 'websocket') return new Response('esperado websocket', { status: 426 });
      const user = JSON.parse(request.headers.get('X-User') || 'null');
      const g = await this.load();
      if (!user || !g) return new Response('sala inexistente', { status: 404 });
      const idx = g.expect.findIndex((p) => p.id === user.id);
      if (idx < 0) return new Response('não é sua sala', { status: 403 });
      const no = idx + 1;

      // Derruba conexão antiga do mesmo jogador (reconexão/aba duplicada).
      for (const old of this.sockets(no)) { try { old.close(1000, 'substituído'); } catch (e) {} }

      const pair = new WebSocketPair();
      this.state.acceptWebSocket(pair[1], ['p' + no]);
      pair[1].serializeAttachment({ no, id: user.id, name: user.name });
      g.players[no] = { id: user.id, name: user.name };
      await this.save();

      // Mensagens iniciais fora do handshake (o cliente já espera esse fluxo).
      queueMicrotask(async () => {
        this.sendTo(no, { t: 'joined', playerNo: no, slots: 2, ranked: true });
        if (g.started) {
          this.sendTo(no, { t: 'rejoined_self' });
          this.sendResync(no);
          this.sendTo(no === 1 ? 2 : 1, { t: 'rejoined', no, name: user.name });
        } else if (this.sockets(1).length && this.sockets(2).length) {
          await this.startGame();
        } else {
          this.sendTo(no, { t: 'waiting' });
        }
      });
      return new Response(null, { status: 101, webSocket: pair[0] });
    }

    return new Response('rota inválida', { status: 404 });
  }

  // ------------------------------------------------------------ início
  async startGame() {
    const g = this.g;
    g.started = true;
    g.balls = makeBalls();
    g.currentTurn = 1;
    g.open = true; g.groups = { 1: null, 2: null };
    g.ballInHand = false; g.gameOver = false; g.winner = 0;
    await this.armTurnTimer();

    const elo = {
      1: await getElo(this.env.DB, g.expect[0].id),
      2: await getElo(this.env.DB, g.expect[1].id),
    };
    const players = {
      1: { name: g.expect[0].name, team: 1 },
      2: { name: g.expect[1].name, team: 2 },
    };
    this.broadcast({
      t: 'start', players, order: [1, 2], startTurn: 1, slots: 2, guide: true,
      ranked: true, elo,
      balls: g.balls.map((b) => ({ n: b.n, x: b.x, y: b.y, potted: b.potted })),
    });
    await this.save();
  }

  sendResync(no) {
    const g = this.g;
    this.sendTo(no, {
      t: 'resync', for: no,
      players: { 1: { name: g.expect[0].name, team: 1 }, 2: { name: g.expect[1].name, team: 2 } },
      order: [1, 2], slots: 2, guide: true, ranked: true,
      game: { open: g.open, groups: g.groups, gameOver: g.gameOver, winner: g.winner },
      matchScore: { 1: 0, 2: 0 }, matchOver: false,
      currentTurn: g.currentTurn, ballInHand: g.ballInHand,
      balls: g.balls ? g.balls.map((b) => ({ n: b.n, x: b.x, y: b.y, potted: b.potted })) : [],
    });
  }

  // ------------------------------------------------------- mensagens WS
  async webSocketMessage(ws, raw) {
    let m; try { m = JSON.parse(raw); } catch (e) { return; }
    const att = ws.deserializeAttachment();
    if (!att) return;
    const g = await this.load();
    if (!g || !g.started || g.finished) return;
    const no = att.no;

    switch (m.t) {
      case 'aim': // repassa a mira ao adversário (não altera estado)
        if (no === g.currentTurn && !g.gameOver) this.sendTo(no === 1 ? 2 : 1, { t: 'aim', a: m.a });
        break;

      case 'ballcue': { // bola na mão: valida a posição e repassa
        if (no !== g.currentTurn || !g.ballInHand || g.gameOver) return;
        const x = Math.max(R + 1, Math.min(W - R - 1, Number(m.x)));
        const y = Math.max(R + 1, Math.min(H - R - 1, Number(m.y)));
        if (!isFinite(x) || !isFinite(y)) return;
        if (g.balls.some((b) => b.n !== 0 && !b.potted && Math.hypot(b.x - x, b.y - y) < 2 * R + 1)) return;
        const cue = g.balls.find((b) => b.n === 0);
        cue.x = x; cue.y = y; cue.potted = false;
        await this.save();
        this.sendTo(no === 1 ? 2 : 1, { t: 'ballcue', x, y });
        break;
      }

      case 'shotinput': await this.handleShot(no, m); break;
    }
  }

  // ------------------------------------------------------------ tacada
  async handleShot(no, m) {
    const g = this.g;
    if (no !== g.currentTurn || g.gameOver) return;
    const ang = Number(m.ang), power = Number(m.power);
    if (!isFinite(ang) || !isFinite(power) || power <= 0) return;
    const p = Math.min(power, 1);
    const a = isFinite(Number(m.a)) ? Number(m.a) : 0;
    const b = isFinite(Number(m.b)) ? Number(m.b) : 0;
    const aimDir = { x: Math.cos(ang), y: Math.sin(ang) };

    // Mesma lógica do cliente (shoot em game3d.js), incluindo miscue.
    let strike = Physics.cueStrike(p, aimDir, a, b);
    let miscue = false;
    if (strike.miscue) {
      miscue = true;
      const dir = Physics.squirtedDir(aimDir, a);
      strike = { vx: dir.x * p * MAX_SHOT * 0.15, vy: dir.y * p * MAX_SHOT * 0.15, wx: 0, wy: 0, wz: 0 };
    }
    const cue = g.balls.find((x) => x.n === 0);
    cue.vx = strike.vx; cue.vy = strike.vy; cue.wx = strike.wx; cue.wy = strike.wy; cue.wz = strike.wz;
    g.ballInHand = false;

    const snapshot = g.balls.map((x) => ({ ...x }));
    const shot = Physics.simulateShot(snapshot);

    // Aplica o estado final (mesma ordem do endShot do cliente).
    for (const fb of shot.finalBalls) {
      const ball = g.balls.find((x) => x.n === fb.n);
      if (ball) { ball.x = fb.x; ball.y = fb.y; ball.potted = fb.potted; ball.vx = ball.vy = ball.wx = ball.wy = ball.wz = 0; }
    }
    const res = Rules.evaluateShot({
      shooter: no, turnOrder: [1, 2], teamOf,
      open: g.open, groups: g.groups,
      balls: g.balls.map((x) => ({ n: x.n, potted: x.potted })),
    }, Rules.deriveRuleEvents(shot.events));

    g.open = res.open; g.groups = res.groups;
    g.gameOver = res.gameOver; g.winner = res.winner;
    g.currentTurn = res.nextTurn; g.ballInHand = res.ballInHand;
    if (cue.potted) { cue.potted = false; cue.x = W * 0.25; cue.y = H / 2; } // branca volta

    this.broadcast({
      t: 'shot', shooter: no, miscue,
      segments: shot.segments, duration: shot.duration, events: shot.events,
      cueSpeed: shot.cueSpeed, finalBalls: shot.finalBalls,
      state: { // autoritativo — o cliente ranqueado usa isto, não o cálculo local
        currentTurn: g.currentTurn, ballInHand: g.ballInHand,
        open: g.open, groups: g.groups, gameOver: g.gameOver, winner: g.winner,
        msg: res.msg, foulReasons: res.foulReasons,
      },
    });

    if (g.gameOver) await this.finish(g.winner, 'game');
    else { await this.armTurnTimer(); await this.save(); }
  }

  // ------------------------------------------------------ fim + timers
  async finish(winnerNo, reason) {
    const g = this.g;
    if (g.finished) return;
    g.finished = true; g.gameOver = true; g.winner = winnerNo;
    const w = g.expect[winnerNo - 1], l = g.expect[winnerNo === 1 ? 1 : 0];
    let result = null;
    try { result = await recordResult(this.env.DB, w, l, reason); }
    catch (e) { console.error('ELO falhou:', e); }
    this.broadcast({
      t: 'ranked_result', winner: winnerNo, reason,
      elo: result ? { winner: result.winnerElo, loser: result.loserElo, delta: result.delta } : null,
    });
    await this.save();
    await this.state.storage.deleteAlarm();
    // Sala fica viva só para leitura do resultado; expira em 5 min.
    await this.state.storage.setAlarm(Date.now() + 300_000);
  }

  async armTurnTimer() {
    this.g.deadline = Date.now() + TURN_MS;
    this.g.deadlineKind = 'turn';
    await this.state.storage.setAlarm(this.g.deadline);
  }

  async webSocketClose(ws) {
    const att = ws.deserializeAttachment();
    const g = await this.load();
    if (!att || !g) return;
    if (g.finished || !g.started) return;
    if (this.sockets(att.no).length) return; // ainda tem outra conexão dele
    this.sendTo(att.no === 1 ? 2 : 1, { t: 'peer_left', no: att.no });
    // Janela de reconexão; se o turno atual já vence antes, mantém o menor.
    const dl = Date.now() + RECONNECT_MS;
    if (!g.deadline || dl < g.deadline) {
      g.deadline = dl; g.deadlineKind = 'reconnect:' + att.no;
      await this.save();
      await this.state.storage.setAlarm(dl);
    }
  }

  async webSocketError(ws) {
    try { ws.close(1011, 'erro de conexão'); } catch (e) {}
    await this.webSocketClose(ws); // trata como queda (janela de reconexão)
  }

  async alarm() {
    const g = await this.load();
    if (!g) return;
    if (g.finished) { await this.state.storage.deleteAll(); this.g = null; return; }
    if (!g.started) { // ninguém veio jogar: sala morre sem ELO
      this.broadcast({ t: 'roomclosed' });
      await this.state.storage.deleteAll(); this.g = null;
      return;
    }
    const p1On = this.sockets(1).length > 0, p2On = this.sockets(2).length > 0;
    if (!p1On && !p2On) { // os dois sumiram: partida anulada, sem ELO
      await this.state.storage.deleteAll(); this.g = null;
      return;
    }
    if (!p1On) return this.finish(2, 'forfeit');
    if (!p2On) return this.finish(1, 'forfeit');
    // Ambos conectados: estourou o tempo da tacada — quem estava na vez perde.
    return this.finish(g.currentTurn === 1 ? 2 : 1, 'timeout');
  }
}
