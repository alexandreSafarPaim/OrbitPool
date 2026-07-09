/* =========================================================================
   OrbitPool — IA do bot de treino (single-player).
   Abordagem baseada no estado da arte de "computational pool" (PickPocket /
   "Running the Table") adaptada ao nosso motor determinístico:
     1) GERA candidatas por "ghost ball": p/ cada bola-alvo × cada caçapa,
        calcula o ponto de contato e a direção do taco.
     2) SIMULA cada candidata no motor real (Physics.simulateShot) e vê se
        encaçapa, se comete falta/scratch e onde a branca para.
     3) AVALIA com Monte Carlo (repete com ruído) p/ estimar probabilidade,
        e pontua o POSICIONAMENTO da branca p/ a próxima bola.
     4) DIFICULDADE = ruído de execução (ângulo/força/efeito) + qualidade da
        escolha + Monte Carlo. 4 níveis.
   Usa os globais Physics, W, H, R (de physics.js).
   API: OrbitBot.decide(state) → { place|null, ang, power, a, b }
   ========================================================================= */
'use strict';

window.OrbitBot = (function () {
  const POCKETS = () => Physics.TABLE.pockets;
  const MAXOFF = () => Physics.MAX_OFFSET;

  // Parâmetros por nível.
  const LEVELS = {
    iniciante: { sigmaAng: 0.070, sigmaPow: 0.16, english: 0.06, minCos: 0.45, mc: 0,  posW: 0,   pickTop: 4, pickRandom: 0.60, think: [700, 1100] },
    amador:    { sigmaAng: 0.021, sigmaPow: 0.08, english: 0.02, minCos: 0.30, mc: 6,  posW: 25,  pickTop: 3, pickRandom: 0.25, think: [800, 1300] },
    pro:       { sigmaAng: 0.010, sigmaPow: 0.045,english: 0.00, minCos: 0.20, mc: 12, posW: 60,  pickTop: 2, pickRandom: 0.06, think: [900, 1500] },
    baianinho: { sigmaAng: 0.0009,sigmaPow: 0.010,english: 0.00, minCos: 0.10, mc: 20, posW: 140, pickTop: 1, pickRandom: 0.00, think: [700, 1200] },
  };

  const groupOf = (n) => (n === 8 ? 'eight' : (n >= 1 && n <= 7 ? 'solid' : (n >= 9 && n <= 15 ? 'stripe' : null)));
  const hyp = (dx, dy) => Math.hypot(dx, dy);
  function gauss(sd) { let u = 0, v = 0; while (!u) u = Math.random(); while (!v) v = Math.random(); return sd * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); }
  const clamp = (x, a, b) => Math.max(a, Math.min(b, x));

  // Constrói o snapshot com a branca em (cx,cy) e velocidade da tacada.
  function makeSnapshot(balls, cx, cy, ang, power, a, b) {
    const aim = { x: Math.cos(ang), y: Math.sin(ang) };
    const dir = Physics.squirtedDir(aim, a);
    let st = Physics.cueStrike(power, dir, a, b);
    if (st.miscue) return null;
    return balls.map((ball) => {
      const o = { n: ball.n, x: ball.x, y: ball.y, vx: 0, vy: 0, wx: 0, wy: 0, wz: 0, potted: ball.potted };
      if (ball.n === 0) { o.x = cx; o.y = cy; o.vx = st.vx; o.vy = st.vy; o.wx = st.wx; o.wy = st.wy; o.wz = st.wz; }
      return o;
    });
  }

  function analyze(res) {
    const potted = [], contacts = [];
    let cuePotted = false;
    for (const e of res.events) {
      if (e.type === 'pocket') potted.push(e.n);
      else if (e.type === 'cuepotted') cuePotted = true;
      else if (e.type === 'contact' && (e.a === 0 || e.b === 0)) contacts.push(e.a === 0 ? e.b : e.a);
    }
    const cueF = res.finalBalls.find((b) => b.n === 0) || { x: 0, y: 0 };
    return { potted, firstHit: contacts.length ? contacts[0] : null, cuePotted, cueF };
  }

  // Qualidade de posição: melhor "jogabilidade" de uma bola própria a partir
  // da posição da branca (ângulo de corte × proximidade). 0..1.
  function positionScore(cueF, ownBalls) {
    let best = 0;
    for (const ob of ownBalls) {
      for (const p of POCKETS()) {
        const dxp = p.x - ob.x, dyp = p.y - ob.y, dop = hyp(dxp, dyp) || 1;
        const dxc = ob.x - cueF.x, dyc = ob.y - cueF.y, dco = hyp(dxc, dyc) || 1;
        const cos = (dxp / dop) * (dxc / dco) + (dyp / dop) * (dyc / dco); // alinhamento branca→bola→caçapa
        if (cos <= 0.1) continue;
        const q = cos * (1 / (1 + dco / 320)) * (1 / (1 + dop / 500));
        if (q > best) best = q;
      }
    }
    return best;
  }

  // Caminho livre entre dois pontos (ignora 'ignore' n)?
  function pathClear(balls, ax, ay, bx, by, ignoreN, rad) {
    const dx = bx - ax, dy = by - ay, L = hyp(dx, dy) || 1e-6, ux = dx / L, uy = dy / L;
    for (const o of balls) {
      if (o.potted || o.n === 0 || o.n === ignoreN) continue;
      const t = (o.x - ax) * ux + (o.y - ay) * uy;
      if (t < 0 || t > L) continue;
      const px = ax + ux * t, py = ay + uy * t;
      if (hyp(o.x - px, o.y - py) < rad) return false;
    }
    return true;
  }

  // Lista de bolas-alvo legais.
  function targets(balls, group, open) {
    const on = (n) => balls.some((b) => b.n === n && !b.potted);
    if (open) return balls.filter((b) => !b.potted && b.n >= 1 && b.n <= 15 && b.n !== 8);
    if (group) {
      const grp = balls.filter((b) => !b.potted && groupOf(b.n) === group);
      if (grp.length) return grp;
      return balls.filter((b) => !b.potted && b.n === 8); // grupo limpo → 8
    }
    return balls.filter((b) => !b.potted && b.n === 8);
  }

  function legalFirstSet(balls, group, open) {
    if (open) return (n) => n !== 8;
    if (group) {
      const left = balls.some((b) => !b.potted && groupOf(b.n) === group);
      return left ? (n) => groupOf(n) === group : (n) => n === 8;
    }
    return (n) => n === 8;
  }

  // Simula uma tacada e devolve a pontuação (maior = melhor).
  function scoreShot(balls, cue, T, ang, power, a, b, ctx) {
    const snap = makeSnapshot(balls, cue.x, cue.y, ang, power, a, b);
    if (!snap) return null;
    let res; try { res = Physics.simulateShot(snap); } catch (e) { return null; }
    if (!res || !isFinite(res.duration)) return null;
    const info = analyze(res);
    const legalFirst = ctx.legalFirst;
    const targetIsEight = T.n === 8;

    if (info.cuePotted) return { score: -2000, res, info };
    if (info.firstHit == null) return { score: -1500, res, info };
    if (!legalFirst(info.firstHit)) return { score: -1200, res, info };

    let s = 0;
    const tPotted = info.potted.includes(T.n);
    const eightPotted = info.potted.includes(8);
    if (eightPotted) {
      if (targetIsEight) return { score: 100000, res, info }; // vitória
      return { score: -8000, res, info }; // 8 fora de hora
    }
    if (tPotted) s += 1000;
    for (const n of info.potted) {
      if (n === 8 || n === T.n) continue;
      s += (groupOf(n) === ctx.group || ctx.open) ? 120 : -160; // bônus própria / penal. adversária
    }
    if (!tPotted) s -= 350; // errou o alvo (legal, mas fraco)
    // posição
    const own = balls.filter((bb) => !bb.potted && bb.n !== 0 && bb.n !== T.n &&
      (ctx.open ? bb.n !== 8 : groupOf(bb.n) === ctx.group));
    s += ctx.posW * positionScore(info.cueF, own.length ? own : balls.filter((bb) => !bb.potted && bb.n === 8));
    return { score: s, res, info, tPotted };
  }

  // Decisão principal.
  function decide(state) {
    const L = LEVELS[state.level] || LEVELS.amador;
    const balls = state.balls;
    let cue = balls.find((b) => b.n === 0) || { x: W * 0.25, y: H / 2 };
    let place = null;

    // Bola na mão: níveis altos otimizam a posição da branca.
    if (state.ballInHand) {
      const cand = [{ x: W * 0.25, y: H / 2 }];
      if (L.posW > 0) {
        for (const t of targets(balls, state.group, state.open)) {
          for (const p of POCKETS()) {
            const dx = t.x - p.x, dy = t.y - p.y, d = hyp(dx, dy) || 1;
            cand.push({ x: clamp(t.x + (dx / d) * 190, R + 6, W - R - 6), y: clamp(t.y + (dy / d) * 190, R + 6, H - R - 6) });
          }
        }
      }
      let bestPos = cand[0], bestv = -Infinity;
      for (const c of cand) {
        if (balls.some((b) => b.n !== 0 && !b.potted && hyp(b.x - c.x, b.y - c.y) < 2 * R + 2)) continue;
        const d = bestFrom(balls, c, state, L, true);
        if (d && d.score > bestv) { bestv = d.score; bestPos = c; }
      }
      place = bestPos; cue = { n: 0, x: bestPos.x, y: bestPos.y, potted: false };
    }

    const best = bestFrom(balls, cue, state, L, false);
    let ang = best.ang, power = best.power, a = best.a, b = best.b;

    // Ruído de execução conforme o nível (mesmo um bom plano pode falhar).
    ang += gauss(L.sigmaAng);
    power = clamp(power + gauss(L.sigmaPow), 0.12, 1);
    if (L.english > 0) {
      a = clamp(a + gauss(L.english), -MAXOFF() * 0.7, MAXOFF() * 0.7);
      b = clamp(b + gauss(L.english), -MAXOFF() * 0.7, MAXOFF() * 0.7);
    }
    return { place, ang, power, a, b, think: L.think };
  }

  // Melhor tacada a partir de uma posição de branca (sem ruído de execução).
  function bestFrom(balls, cue, state, L, quick) {
    const ctx = { group: state.group, open: state.open, legalFirst: legalFirstSet(balls, state.group, state.open), posW: L.posW };
    const cand = [];
    for (const T of targets(balls, state.group, state.open)) {
      for (const p of POCKETS()) {
        const dxp = p.x - T.x, dyp = p.y - T.y, dop = hyp(dxp, dyp) || 1;
        const gx = T.x - (dxp / dop) * 2 * R, gy = T.y - (dyp / dop) * 2 * R; // ghost ball
        const dxc = gx - cue.x, dyc = gy - cue.y, dcg = hyp(dxc, dyc) || 1;
        const ang = Math.atan2(dyc, dxc);
        const cos = (dxc / dcg) * (dxp / dop) + (dyc / dcg) * (dyp / dop); // corte
        if (cos < L.minCos) continue;
        // caminho branca→ghost e bola→caçapa razoavelmente livres
        if (!pathClear(balls, cue.x, cue.y, gx, gy, T.n, 2 * R - 2)) continue;
        if (!pathClear(balls, T.x, T.y, p.x, p.y, T.n, R + 2)) continue;
        const power = clamp(0.30 + 0.00075 * (dcg + 1.5 * dop) + (1 - cos) * 0.35, 0.32, 0.98);
        const sc = scoreShot(balls, cue, T, ang, power, 0, 0, ctx);
        if (sc) cand.push({ ang, power, a: 0, b: 0, T, ...sc });
      }
    }
    if (!cand.length) return safety(balls, cue, state, L, ctx);
    cand.sort((x, y) => y.score - x.score);

    // Monte Carlo nos melhores (níveis altos): reestima com ruído de mira.
    if (!quick && L.mc > 0) {
      for (const c of cand.slice(0, 3)) {
        let pots = 0;
        for (let i = 0; i < L.mc; i++) {
          const sc = scoreShot(balls, cue, c.T, c.ang + gauss(L.sigmaAng), c.power + gauss(L.sigmaPow * 0.5), 0, 0, ctx);
          if (sc && sc.tPotted && sc.score > 0) pots++;
        }
        c.score = c.score * (0.35 + 0.65 * (pots / L.mc)); // pondera pela robustez
      }
      cand.sort((x, y) => y.score - x.score);
    }

    // Escolha imperfeita nos níveis baixos.
    let pick = cand[0];
    if (L.pickRandom > 0 && Math.random() < L.pickRandom && cand.length > 1) {
      pick = cand[Math.floor(Math.random() * Math.min(L.pickTop, cand.length))];
    }
    return pick;
  }

  // Defesa: sem encaçapada boa, bate de leve na bola legal mais próxima.
  function safety(balls, cue, state, L, ctx) {
    const legal = targets(balls, state.group, state.open);
    let tgt = null, bd = Infinity;
    for (const t of legal) { const d = hyp(t.x - cue.x, t.y - cue.y); if (d < bd) { bd = d; tgt = t; } }
    if (!tgt) tgt = balls.find((b) => !b.potted && b.n !== 0) || { x: W / 2, y: H / 2 };
    const ang = Math.atan2(tgt.y - cue.y, tgt.x - cue.x);
    return { ang, power: 0.45, a: 0, b: 0, T: tgt, score: -300 };
  }

  return { decide, LEVELS };
})();
