/* =========================================================================
   Bilhar Multiplayer — motor de física event-based (docs/fisica.md)
   Núcleo puro (sem DOM/rede): dado o estado inicial das bolas + parâmetros
   da tacada, calcula analiticamente a tacada INTEIRA de uma vez (sliding,
   rolling, colisões bola-bola com throw, colisões de tabela com spin,
   caçapas) e devolve uma timeline (segments) que pode ser avaliada em
   qualquer instante t — tanto pelo jogador que atirou quanto pelo
   espectador, que só faz playback dos mesmos dados (sem re-simular).

   Só os NOMES A SEGUIR viram globais compartilhados com game.js (dimensões
   da mesa, usadas também para desenhar): W, H, RAIL, R, POCKET, MOUTH,
   POCKETS, MAX_SHOT, STOP_SPEED. O resto fica encapsulado no objeto Physics.
   ========================================================================= */

'use strict';

// ---- Dimensões do mundo (compartilhadas com o render em game.js) ----------
// Campo NATIVO do modelo GLB "Billiard Table" (Futurealiti, CC-BY-4.0).
// Medido na BORRACHA das almofadas (não na madeira!), na banda de contato da
// bola e com correção da inclinação da face: linha de parada do CENTRO da
// bola a ±1.1724m × ±0.5670m ⇒ borda física (centro+R) abaixo. Escala
// 354.331 unid/m (= 9 unid/polegada — física inalterada).
const W = 850.4;         // comprimento entre paredes efetivas
const H = 421.4;         // largura — proporção 2.018:1 (mesa 2:1 real!)
const RAIL = 34;
const R = 9.8;
const POCKET = 21;
const MOUTH = 27;
const MAX_SHOT = 1650;   // velocidade máx. de uma tacada central (unidades/s), ~10mph
const STOP_SPEED = 9;    // abaixo disto a bola some para v=0 (evita ruído numérico)

const POCKETS = [
  { x: 0, y: 0 }, { x: W / 2, y: 0 }, { x: W, y: 0 },
  { x: 0, y: H }, { x: W / 2, y: H }, { x: W, y: H },
];

const Physics = (function () {
  // ---- Constantes físicas ---------------------------------------------------
  // Escala: mesa 900x450 = mesa de 9 pés (100x50 pol) => 9 unidades/polegada.
  // Isso permite usar direto os coeficientes de atrito reais (g em pol/s²).
  const UNIT_PER_INCH = 9;
  const G = 386.4 * UNIT_PER_INCH; // ~3478 unidades/s²

  const MU_SLIDE = 0.2;    // atrito de deslizamento bola-pano (§4.1)
  const MU_ROLL = 0.011;   // atrito de rolamento bola-pano (§4.2)
  const MU_SPIN = 0.011;   // decaimento do spin vertical/inglês, calibrado p/ ~8 rad/s² (§4.3-4.4)
  const SPIN_DECEL = (5 * MU_SPIN * G) / (2 * R); // rad/s²

  const REST_BALL = 0.95;       // restituição bola-bola (§6.1)
  const MU_BALL_BALL = 0.06;    // atrito bola-bola base, decai com velocidade (§6.2)

  const REST_RAIL_BASE = 0.85;      // restituição bola-tabela na normal, base (§7.1/7.2)
  const REST_RAIL_VEL_DROP = 0.022; // e_bc cai com a velocidade normal (m/s)
  const CUSHION_TANGENT_FACTOR = 0.85; // perda tangencial no rebote (k_t §7.1)
  const CUSHION_SPIN_SHIFT = 0.2;      // inglês desloca a tangencial no rebote (f_spin §7.1)
  const CUSHION_WZ_RETAIN = 0.65;      // fração do spin vertical retida após o rebote

  // Jaws/chanfros da CAÇAPA: o facing (couro/borracha) absorve muito mais que
  // a almofada — numa mesa real a bola que bate na boca MORRE e cai, não é
  // cuspida de volta. Restituição e tangencial bem menores que as da tabela.
  const REST_JAW_BASE = 0.47;
  const JAW_TANGENT_FACTOR = 0.76;
  const JAW_WZ_RETAIN = 0.5;

  const CUE_MASS_RATIO = 0.3; // m/M (bola ~0,17kg / taco ~0,57kg) — §5.2
  const K_SQUIRT = 0.075;     // deflexão do taco com efeito lateral (§5.4)
  const MAX_OFFSET = 0.5;     // limite físico de (a,b) — além disso é miscue (§5.1)

  // Conversão para as fórmulas do relatório que usam m/s (dados experimentais)
  const WORLD_TO_MPS = 1 / (UNIT_PER_INCH * 39.3701);

  // ---- Geometria das tabelas e das bocas das caçapas (§7.3, §8) -------------
  // Modelo realista: cada rail é um SEGMENTO reto (linha de contato do CENTRO
  // da bola) e cada ponta do rail perto de uma caçapa é CHANFRADA (jaw) — um
  // segmento angulado que reflete a bola. A bola só é encaçapada quando o
  // CENTRO dela entra no círculo de captura da caçapa (i.e., quando o centro
  // de gravidade passa sobre o buraco). Assim ela pode bater no chanfro,
  // desviar e até chacoalhar de um lado ao outro e voltar pra mesa (rattle).
  // Geometria das bocas MEDIDA na borracha do modelo GLB (banda de contato):
  // CT visual medido ≈ 20, mas a boca de canto do modelo é justa (10cm = 1.8
  // diâmetros). +5 de tolerância invisível por lado para não ficar punitiva
  // (a bola sobrepõe ~1.4cm da ponta desenhada ao entrar — imperceptível).
  const CT = 25;
  const MT = 26.5;        // meia-boca do meio (vão visual = 53.2 ≈ 15 cm — generosa)
  const CHF = 18;         // comprimento (projetado) do chanfro
  // Captura = a bola cai só quando o CENTRO dela passa sobre o buraco.
  // Centros ≈ furos reais do modelo (canto ~7.5 unid. ALÉM do vértice, na
  // diagonal; meio ~13 além do nariz). Conferido: bola rolando rente ao rail
  // (centro a R=9.8 da parede) passa a >2 unid. de qualquer captura.
  const CAP_CORNER = 17;  // raio de captura da caçapa de canto
  const CAP_MID = 14;     // raio de captura da caçapa do meio
  const COUT = 6;         // furo do canto: centro além do vértice (diagonal)
  const PD = 13;          // furo do meio: centro além da linha do nariz
  const XL = R, XR = W - R, YT = R, YB = H - R;   // linhas de contato dos rails
  const MX = W / 2;

  // Constrói um segmento com normal unitária apontando para (refx,refy).
  function makeSeg(ax, ay, bx, by, refx, refy) {
    const dx = bx - ax, dy = by - ay, L = Math.hypot(dx, dy) || 1e-9;
    const ux = dx / L, uy = dy / L;
    let nx = -uy, ny = ux;
    if ((refx - ax) * nx + (refy - ay) * ny < 0) { nx = -nx; ny = -ny; }
    return withBBox({ ax, ay, bx, by, ux, uy, L, nx, ny });
  }
  // BBox do segmento (pré-filtro de alcance: pula paredes inalcançáveis).
  function withBBox(s) {
    s.minx = Math.min(s.ax, s.bx); s.maxx = Math.max(s.ax, s.bx);
    s.miny = Math.min(s.ay, s.by); s.maxy = Math.max(s.ay, s.by);
    return s;
  }
  const CX = MX, CY = H / 2; // centro da mesa (referência de "para dentro")

  // Rails retos (entre as pontas junto às caçapas).
  const SEGMENTS = [
    makeSeg(CT, YT, MX - MT, YT, CX, CY),        // topo-esquerda
    makeSeg(MX + MT, YT, W - CT, YT, CX, CY),    // topo-direita
    makeSeg(CT, YB, MX - MT, YB, CX, CY),        // base-esquerda
    makeSeg(MX + MT, YB, W - CT, YB, CX, CY),    // base-direita
    makeSeg(XL, CT, XL, H - CT, CX, CY),         // esquerda
    makeSeg(XR, CT, XR, H - CT, CX, CY),         // direita
  ];

  // Chanfros (jaws): partem da ponta de cada rail recuando em direção à caçapa.
  const CHAMFERS = [
    // canto TL
    makeSeg(CT, YT, CT - CHF, YT - CHF, CX, CY), makeSeg(XL, CT, XL - CHF, CT - CHF, CX, CY),
    // canto TR
    makeSeg(W - CT, YT, W - CT + CHF, YT - CHF, CX, CY), makeSeg(XR, CT, XR + CHF, CT - CHF, CX, CY),
    // canto BL
    makeSeg(CT, YB, CT - CHF, YB + CHF, CX, CY), makeSeg(XL, H - CT, XL - CHF, H - CT + CHF, CX, CY),
    // canto BR
    makeSeg(W - CT, YB, W - CT + CHF, YB + CHF, CX, CY), makeSeg(XR, H - CT, XR + CHF, H - CT + CHF, CX, CY),
    // meio topo
    makeSeg(MX - MT, YT, MX - MT + CHF, YT - CHF, CX, CY), makeSeg(MX + MT, YT, MX + MT - CHF, YT - CHF, CX, CY),
    // meio base
    makeSeg(MX - MT, YB, MX - MT + CHF, YB + CHF, CX, CY), makeSeg(MX + MT, YB, MX + MT - CHF, YB + CHF, CX, CY),
  ];

  // Marca os chanfros como "jaw" (boca de caçapa): rebote morto (§ acima).
  for (const c of CHAMFERS) c.jaw = true;

  // Geometria de colisão (substituível via setTable p/ usar o contorno de um
  // modelo 3D). Por padrão = geometria analítica (usada pelo 2D).
  let ALL_WALLS = SEGMENTS.concat(CHAMFERS);
  let customTable = false; // true quando um colisor de modelo é carregado

  // Pontas convexas (tips) — usadas SÓ por colisores de modelo (setTable).
  // Na geometria analítica rail e chanfro são CONTÍNUOS no mesmo vértice, e os
  // antigos tips em (CT,0)/(MX±MT,0) tangenciavam exatamente a linha de
  // rolagem rente ao rail: bola indo pro canto batia numa "paredinha
  // invisível" na entrada da boca. Removidos.
  let TIPS = [];

  // Círculos de captura (a bola cai quando o CENTRO entra aqui).
  let PCAPS = [
    { x: -COUT, y: -COUT, cap: CAP_CORNER }, { x: MX, y: -PD, cap: CAP_MID }, { x: W + COUT, y: -COUT, cap: CAP_CORNER },
    { x: -COUT, y: H + COUT, cap: CAP_CORNER }, { x: MX, y: H + PD, cap: CAP_MID }, { x: W + COUT, y: H + COUT, cap: CAP_CORNER },
  ];

  // Substitui a geometria de colisão pelo contorno de um modelo (3D). geom =
  // { segments:[[ax,ay,bx,by,nx,ny,jaw?],...], pockets:[{x,y,cap},...],
  //   tips:[{x,y},...] } — tips = pontas convexas (bocas) p/ a bola ricochetear.
  function setTable(geom) {
    try {
      const ws = geom.segments.map((s) => {
        const ax = s[0], ay = s[1], bx = s[2], by = s[3];
        let dx = bx - ax, dy = by - ay; const L = Math.hypot(dx, dy) || 1e-9;
        return withBBox({ ax, ay, bx, by, ux: dx / L, uy: dy / L, L, nx: s[4], ny: s[5], jaw: !!s[6] });
      });
      if (!ws.length || !geom.pockets || !geom.pockets.length) return false;
      ALL_WALLS = ws;
      TIPS = (geom.tips || []).map((t) => ({ x: t.x, y: t.y }));
      PCAPS = geom.pockets.map((p) => ({ x: p.x, y: p.y, cap: p.cap || 15 }));
      customTable = true;
      return true;
    } catch (e) { return false; }
  }

  // ===========================================================================
  // Vetores / números complexos auxiliares
  // ===========================================================================
  const cross2 = (ax, ay, bx, by) => ax * by - ay * bx;

  const cadd = (a, b) => ({ re: a.re + b.re, im: a.im + b.im });
  const csub = (a, b) => ({ re: a.re - b.re, im: a.im - b.im });
  const cmul = (a, b) => ({ re: a.re * b.re - a.im * b.im, im: a.re * b.im + a.im * b.re });
  const cdiv = (a, b) => {
    const d = b.re * b.re + b.im * b.im || 1e-300;
    return { re: (a.re * b.re + a.im * b.im) / d, im: (a.im * b.re - a.re * b.im) / d };
  };
  const cabs = (a) => Math.hypot(a.re, a.im);

  // ===========================================================================
  // Solver de polinômios reais até grau 4 (para achar o tempo de eventos)
  // coeffs = [c0, c1, ..., cn]  (c0 + c1*t + ... + cn*t^n = 0)
  // Retorna as raízes REAIS (array de números, não ordenado).
  // ===========================================================================
  function polyRealRoots(coeffs) {
    let n = coeffs.length - 1;
    // Descarta coeficientes de maior ordem desprezíveis (reduz o grau efetivo).
    const scale = Math.max(1e-12, ...coeffs.map((c) => Math.abs(c)));
    while (n > 0 && Math.abs(coeffs[n]) < 1e-10 * scale) n--;
    if (n <= 0) return [];
    if (n === 1) return [-coeffs[0] / coeffs[1]];
    if (n === 2) {
      const [c0, c1, c2] = coeffs;
      const disc = c1 * c1 - 4 * c2 * c0;
      if (disc < 0) return [];
      const sq = Math.sqrt(disc);
      return [(-c1 - sq) / (2 * c2), (-c1 + sq) / (2 * c2)];
    }
    // Grau 3 ou 4: Durand-Kerner (Weierstrass) em ponto flutuante complexo.
    const a = coeffs.slice(0, n + 1).map((c) => c / coeffs[n]); // monico
    let roots = [];
    let p = { re: 1, im: 0 };
    const seed = { re: 0.4, im: 0.9 }; // semente clássica do método
    for (let i = 0; i < n; i++) { p = cmul(p, seed); roots.push(p); }

    const evalPoly = (x) => {
      let result = { re: 0, im: 0 };
      for (let i = n; i >= 0; i--) result = cadd(cmul(result, x), { re: a[i], im: 0 });
      return result;
    };

    for (let iter = 0; iter < 120; iter++) {
      let maxDelta = 0;
      const next = roots.map((ri, i) => {
        let denom = { re: 1, im: 0 };
        for (let j = 0; j < n; j++) {
          if (j === i) continue;
          denom = cmul(denom, csub(ri, roots[j]));
        }
        const delta = cdiv(evalPoly(ri), denom);
        maxDelta = Math.max(maxDelta, cabs(delta));
        return csub(ri, delta);
      });
      roots = next;
      if (maxDelta < 1e-9) break;
    }

    const realScale = Math.max(1, ...roots.map((r) => Math.abs(r.re)));
    const real = roots.filter((r) => Math.abs(r.im) < 1e-4 * realScale).map((r) => r.re);

    // Polimento de Newton no polinômio REAL: o Durand-Kerner em 120 iterações
    // pode deixar erro residual (sobretudo com coeficientes grandes de tacadas
    // fortes). Sem isto, uma raiz imprecisa desloca o instante de contato e o
    // reposicionamento teleporta a bola — era a causa do break "explodir".
    const dp = a.map((c, i) => i * c).slice(1); // derivada
    const evalR = (poly, t) => { let s = 0; for (let i = poly.length - 1; i >= 0; i--) s = s * t + poly[i]; return s; };
    return real.map((t) => {
      for (let k = 0; k < 40; k++) {
        const f = evalR(a, t), df = evalR(dp, t);
        if (Math.abs(df) < 1e-14) break;
        const step = f / df;
        t -= step;
        if (Math.abs(step) < 1e-12 * (1 + Math.abs(t))) break;
      }
      return t;
    });
  }

  function smallestPositiveRoot(coeffs, eps) {
    const roots = polyRealRoots(coeffs).filter((r) => r > eps);
    if (!roots.length) return Infinity;
    return Math.min(...roots);
  }

  // ===========================================================================
  // Estado de movimento de uma bola (fase + forma fechada da trajetória)
  // ===========================================================================
  // Uma bola "ativa" carrega, além de x,y,vx,vy,wx,wy,wz:
  //   phase: 'slide' | 'roll' | 'stopped' | 'potted'
  //   dir:   {x,y} — û (slide) ou v̂ (roll); irrelevante nas outras fases
  //   u0mag: |u| no início da fase de slide (usado para achar o fim da fase)

  function slipVector(vx, vy, wx, wy) {
    // u = v + R·(ẑ × ω_horizontal) → em 2D: u = (vx − R·ωy, vy + R·ωx)  (§3.2)
    return { x: vx - R * wy, y: vy + R * wx };
  }

  // Classifica a fase atual de uma bola a partir do seu estado bruto.
  function classify(b) {
    const u = slipVector(b.vx, b.vy, b.wx, b.wy);
    const umag = Math.hypot(u.x, u.y);
    if (umag > 1e-3) {
      b.phase = 'slide';
      b.dir = { x: u.x / umag, y: u.y / umag };
      b.u0mag = umag;
    } else if (Math.hypot(b.vx, b.vy) > 1e-3) {
      b.phase = 'roll';
      const sp = Math.hypot(b.vx, b.vy);
      b.dir = { x: b.vx / sp, y: b.vy / sp };
    } else {
      b.phase = 'stopped';
      b.vx = 0; b.vy = 0; b.wx = 0; b.wy = 0;
      b.dir = { x: 0, y: 0 };
    }
    return b;
  }

  function decayWz(wz0, tau) {
    if (wz0 === 0) return 0;
    const mag = Math.max(0, Math.abs(wz0) - SPIN_DECEL * tau);
    return Math.sign(wz0) * mag;
  }

  // Avança analiticamente uma bola por dt segundos dentro da SUA fase atual
  // (não cruza transições — o loop de eventos garante que dt nunca ultrapassa
  // o próximo evento dessa bola).
  function advance(b, dt) {
    if (b.potted || b.phase === 'stopped') {
      b.wz = decayWz(b.wz, dt);
      return b;
    }
    const decel = b.phase === 'slide' ? MU_SLIDE * G : MU_ROLL * G;
    const dx = b.dir.x, dy = b.dir.y;
    const x = b.x + b.vx * dt - 0.5 * decel * dt * dt * dx;
    const y = b.y + b.vy * dt - 0.5 * decel * dt * dt * dy;
    const vx = b.vx - decel * dt * dx;
    const vy = b.vy - decel * dt * dy;
    let wx, wy;
    if (b.phase === 'slide') {
      const spinAccel = 2.5 * decel / R; // (5μsG)/(2R)
      wx = b.wx + spinAccel * dt * (-dy);
      wy = b.wy + spinAccel * dt * (dx);
    } else {
      // Rolamento puro: ω_horizontal = (ẑ × v)/R, mantido a cada instante (§4.2)
      wx = -vy / R;
      wy = vx / R;
    }
    b.x = x; b.y = y; b.vx = vx; b.vy = vy; b.wx = wx; b.wy = wy;
    b.wz = decayWz(b.wz, dt);
    return b;
  }

  // Tempo (a partir de agora) até a bola sair da fase atual, ou Infinity.
  function transitionTime(b) {
    if (b.phase === 'slide') {
      // Tempo RESTANTE de deslizamento a partir do slip ATUAL (não de b.u0mag,
      // que é o slip do INÍCIO da fase). Se a bola já foi evoluída parcialmente
      // por causa do evento de outra bola, u0mag superestima o tempo restante e
      // deixa bestT ultrapassar o instante em que u=0 — aí a equação de slide
      // passa a INJETAR energia (§3.3, "bug clássico"). Recalcular evita isso.
      const u = slipVector(b.vx, b.vy, b.wx, b.wy);
      return (2 * Math.hypot(u.x, u.y)) / (7 * MU_SLIDE * G);
    }
    if (b.phase === 'roll') return Math.hypot(b.vx, b.vy) / (MU_ROLL * G);
    return Infinity;
  }

  // ===========================================================================
  // Detecção analítica de eventos (tempos, a partir do estado "agora")
  // ===========================================================================
  function motionCoeffs(b) {
    if (b.potted || b.phase === 'stopped') {
      return { x0: b.x, y0: b.y, vx0: 0, vy0: 0, ax: 0, ay: 0 };
    }
    const decel = -(b.phase === 'slide' ? MU_SLIDE * G : MU_ROLL * G);
    return { x0: b.x, y0: b.y, vx0: b.vx, vy0: b.vy, ax: decel * b.dir.x, ay: decel * b.dir.y };
  }

  // Tempo até |posA(t) - posB(t)| == targetDist (quártica, §6.3).
  function approachTime(qa, qb, targetDist) {
    const A2 = 0.5 * (qa.ax - qb.ax), A1 = qa.vx0 - qb.vx0, A0 = qa.x0 - qb.x0;
    const B2 = 0.5 * (qa.ay - qb.ay), B1 = qa.vy0 - qb.vy0, B0 = qa.y0 - qb.y0;
    const c4 = A2 * A2 + B2 * B2;
    const c3 = 2 * A1 * A2 + 2 * B1 * B2;
    const c2 = A1 * A1 + 2 * A0 * A2 + B1 * B1 + 2 * B0 * B2;
    const c1 = 2 * A0 * A1 + 2 * B0 * B1;
    const c0 = A0 * A0 + B0 * B0 - targetDist * targetDist;
    const coeffs = [c0, c1, c2, c3, c4];

    // dist²(t) e sua derivada, para VALIDAR cada raiz candidata.
    const f = (t) => (((c4 * t + c3) * t + c2) * t + c1) * t + c0;
    const df = (t) => ((4 * c4 * t + 3 * c3) * t + 2 * c2) * t + c1;
    const tol = 1e-3 * (targetDist * targetDist); // tolerância relativa ao alvo

    // Par JÁ SOBREPOSTO (dist < alvo) e se aproximando: colide imediatamente.
    // Sem isto não existe raiz "chegando a 2R vindo de fora" e as bolas se
    // ATRAVESSAM (ex.: bola encostada/sobreposta perto da boca da caçapa).
    // resolveBallBall já reposiciona o par para a distância de contato.
    if (c0 < -tol && c1 < -1e-3) return 1e-5;

    let best = Infinity;
    for (const t of polyRealRoots(coeffs)) {
      if (t <= 1e-6) continue;               // ignora colisão recém-resolvida (§10.2)
      if (Math.abs(f(t)) > tol) continue;     // raiz espúria: não está no alvo → descarta
      if (df(t) >= 0) continue;               // distância crescendo → separando, não é colisão
      if (t < best) best = t;
    }
    return best;
  }

  // Tempo até a bola tocar um SEGMENTO reto (rail ou chanfro). O contato ocorre
  // quando a distância (com sinal, ao longo da normal interna n̂) do centro à
  // reta do segmento chega a R, aproximando-se, e o ponto de contato cai dentro
  // da extensão do segmento.
  function segTime(qa, seg) {
    // As retas de colisão estão na linha de contato do CENTRO (o analítico por
    // construção; o contorno do modelo já vem ERODIDO por R). Alvo = 0: o centro
    // para AO alcançar a reta, e a borda da bola encosta na parede visível.
    const s0 = (qa.x0 - seg.ax) * seg.nx + (qa.y0 - seg.ay) * seg.ny;
    const s1 = qa.vx0 * seg.nx + qa.vy0 * seg.ny;
    const s2 = 0.5 * (qa.ax * seg.nx + qa.ay * seg.ny);
    const roots = polyRealRoots([s0, s1, s2]).filter((r) => r > 1e-6).sort((a, b) => a - b);
    for (const t of roots) {
      if (2 * s2 * t + s1 >= 0) continue; // afastando da parede → não é impacto
      const cx = qa.x0 + qa.vx0 * t + 0.5 * qa.ax * t * t;
      const cy = qa.y0 + qa.vy0 * t + 0.5 * qa.ay * t * t;
      const u = (cx - seg.ax) * seg.ux + (cy - seg.ay) * seg.uy; // projeção no segmento
      if (u >= -1e-6 && u <= seg.L + 1e-6) return t;
    }
    return Infinity;
  }

  // Tempo até o CENTRO cruzar uma linha externa (rede de segurança anti-escape).
  function boundTime(qa, isX, value) {
    const a2 = 0.5 * (isX ? qa.ax : qa.ay);
    const a1 = isX ? qa.vx0 : qa.vy0;
    const a0 = (isX ? qa.x0 : qa.y0) - value;
    const roots = polyRealRoots([a0, a1, a2]).filter((r) => r > 1e-6);
    return roots.length ? Math.min(...roots) : Infinity;
  }
  // Profundidade da linha de captura (atrás das gargantas dos chanfros, que
  // ficam a CHF−R além da borda). A bola cai ao cruzar essa linha no fundo da boca.
  const CAPD = (CHF - R) + 4;

  // ===========================================================================
  // Resolução de eventos
  // ===========================================================================
  function resolveTransition(b) {
    if (b.phase === 'slide') {
      classify(b); // recalcula a partir de v,w atuais (u≈0 → cai para roll/stopped)
    } else if (b.phase === 'roll') {
      b.vx = 0; b.vy = 0; b.phase = 'stopped'; b.dir = { x: 0, y: 0 };
    }
  }

  // Colisão bola-bola com throw (§6.1 + §6.2).
  function resolveBallBall(a, b) {
    const dx = b.x - a.x, dy = b.y - a.y;
    let dist = Math.hypot(dx, dy) || 1e-6;
    const nx = dx / dist, ny = dy / dist;

    const van = a.vx * nx + a.vy * ny, vbn = b.vx * nx + b.vy * ny;
    // GUARD (§10.3): só há colisão se as bolas estiverem se APROXIMANDO
    // (velocidade relativa normal fechando o gap). Sem isso, uma detecção
    // numérica espúria de um par que já se separa faria o impulso INVERTER a
    // velocidade e injetar energia — foi o que fazia o break "explodir".
    const approach = van - vbn; // > 0 ⇒ aproximando
    if (approach <= 1e-6) return;

    // Reposiciona exatamente no contato + um nudge minúsculo extra: sem isso o
    // par fica com distância == 2R exatamente e o próximo passo do loop de
    // eventos pode redetectar uma raiz ~0 para a MESMA colisão (§10.2).
    const correction = (dist - 2 * R) / 2 - 1e-3;
    a.x += nx * correction; a.y += ny * correction;
    b.x -= nx * correction; b.y -= ny * correction;

    const p = ((1 + REST_BALL) / 2) * (vbn - van); // impulso normal por unidade de massa

    // --- throw: atrito tangencial limitado por Coulomb (§6.2) ---
    const tx = -ny, ty = nx;
    const relTang = (a.vx - b.vx) * tx + (a.vy - b.vy) * ty;
    // Contribuição do spin vertical (inglês) na superfície de contato — apenas
    // ωz entra no plano tangencial; ωx/ωy geram componente fora do plano.
    const spinContrib = R * (a.wz + b.wz); // (R(ω1+ω2)×n̂)·t̂
    const vRelContact = relTang + spinContrib;

    const vRelMag = Math.abs(vRelContact);
    // μbb decai com a velocidade de impacto (aprox. dados do Dr. Dave, §6.2).
    const muDyn = Math.min(0.08, MU_BALL_BALL * Math.exp(-0.7 * Math.abs(p) * WORLD_TO_MPS) + 0.01);
    const jMax = muDyn * Math.abs(p);
    // Impulso que ZERA o slip de contato (gearing): cada unidade de jt reduz o
    // slip em 7·jt para massas iguais (2·jt linear + 5·jt via Δωz=5jt/2R nas
    // duas bolas). Mais que isso inverteria o slip — atrito não faz isso.
    const jStop = vRelMag / 7;
    const jt = Math.sign(vRelContact) * Math.min(jMax, jStop);

    a.vx += nx * p - tx * jt; a.vy += ny * p - ty * jt;
    b.vx -= nx * p - tx * jt; b.vy -= ny * p - ty * jt;

    // Torque do impulso tangencial: ponto de contato em ±R·n̂ a partir do centro.
    const I_COEF = (2 / 5) * R * R;
    const jtx = -tx * jt, jty = -ty * jt; // impulso (por massa) aplicado à bola a
    a.wz += cross2(R * nx, R * ny, jtx, jty) / I_COEF;
    b.wz += cross2(-R * nx, -R * ny, -jtx, -jty) / I_COEF;

    classify(a); classify(b);
  }

  // Reflexão da bola numa parede de normal interna (nx,ny) — rail, chanfro ou
  // a ponta (jaw) de um rail. Restituição depende da velocidade normal e o
  // inglês (ωz) desloca a tangencial (§7.1).
  function resolveWall(b, nx, ny, jaw) {
    const vn = b.vx * nx + b.vy * ny; // componente ao longo da normal interna
    if (vn >= 0) return;              // já se afastando → não é impacto (guard energia)
    const tx = -ny, ty = nx;
    const vt = b.vx * tx + b.vy * ty;
    const vnMps = Math.abs(vn) * WORLD_TO_MPS;
    // Jaw (boca da caçapa): facing absorvente — rebote morto p/ a bola cair.
    // No jaw a restituição CAI FORTE com a velocidade (couro/borracha da boca
    // engole tacadas rápidas — evita o rattle irreal cuspir a bola de volta).
    const e = jaw
      ? Math.max(0.22, REST_JAW_BASE - 0.09 * vnMps)
      : Math.min(0.90, Math.max(0.65, REST_RAIL_BASE - REST_RAIL_VEL_DROP * vnMps));
    const CUSHION_TANGENT = jaw ? JAW_TANGENT_FACTOR : CUSHION_TANGENT_FACTOR;
    const WZ_RETAIN = jaw ? JAW_WZ_RETAIN : CUSHION_WZ_RETAIN;

    const vnOut = -e * vn;
    // Contato no lado da almofada (−R·n̂): slip do inglês = −R·ωz·t̂; o atrito
    // se opõe ao slip ⇒ Δvt = +f_spin·R·ωz (running english alarga o rebote,
    // check side encurta — consistente com o throw bola-bola e docs §7.1).
    const vtOut = vt * CUSHION_TANGENT + CUSHION_SPIN_SHIFT * R * b.wz;

    b.vx = vnOut * nx + vtOut * tx;
    b.vy = vnOut * ny + vtOut * ty;
    b.wz *= WZ_RETAIN;
    // Empurra levemente para dentro para não redetectar a mesma colisão.
    b.x += nx * 1e-3; b.y += ny * 1e-3;
    classify(b);
  }

  // Reflexão ao bater na PONTA (jaw) de um rail, tratada como ponto/círculo.
  function resolveTip(b, tip) {
    let dx = b.x - tip.x, dy = b.y - tip.y;
    const d = Math.hypot(dx, dy) || 1e-6;
    resolveWall(b, dx / d, dy / d, true); // ponta do rail = boca da caçapa → rebote morto
  }

  // ===========================================================================
  // Tacada (§5)
  // ===========================================================================
  // Deflexão do taco (squirt) quando há efeito lateral (a≠0) — usada tanto no
  // cálculo real da tacada quanto na pré-visualização da linha de mira.
  // Convenção de 'a': >0 = taco bate à DIREITA do centro (visão do jogador,
  // igual ao widget de efeito). O mundo RENDERIZADO é espelhado em relação ao
  // referencial matemático (física x,y → three X,Z inverte a quiralidade;
  // screen-right = ẑ×d̂), então os sinais abaixo já compensam isso.
  function squirtedDir(aimDir, a) {
    const angle = Math.atan(-a * K_SQUIRT); // squirt deflete pro lado OPOSTO ao efeito
    const cosA = Math.cos(angle), sinA = Math.sin(angle);
    return { x: aimDir.x * cosA - aimDir.y * sinA, y: aimDir.x * sinA + aimDir.y * cosA };
  }

  // Calcula v/ω iniciais da bola branca a partir de (power,aimDir,a,b).
  // Penalidade de velocidade por tacar fora do centro. O valor FÍSICO exato é
  // 2.5 (= 5/2: energia vira spin), mas na prática o jogador real compensa
  // tacando mais forte — com 2.5 o draw máximo saía 32% mais lento e chegava
  // com ~1/3 da velocidade (reclamação geral). 1.2 = meio-termo: ainda há
  // custo por efeito (realismo), sem esvaziar a tacada.
  const SPIN_SPEED_TAX = 1.2;

  function cueStrike(power, aimDir, a, b) {
    if (Math.hypot(a, b) > MAX_OFFSET) return { miscue: true };
    const offset2 = a * a + b * b;
    // V0 equivalente calibrado para que uma tacada central (a=b=0) reproduza
    // exatamente `power*MAX_SHOT`, preservando a sensação de jogo já calibrada.
    const V0 = (power * MAX_SHOT) * (1 + CUE_MASS_RATIO) / 2;
    const speed = (2 * V0) / (1 + CUE_MASS_RATIO + SPIN_SPEED_TAX * offset2);

    const dir = squirtedDir(aimDir, a);
    const tHatX = -dir.y, tHatY = dir.x; // ẑ × d̂ (eixo horizontal do topspin/backspin)
    const spinMag = (5 * speed) / (2 * R);

    return {
      miscue: false,
      vx: dir.x * speed, vy: dir.y * speed,
      wx: tHatX * b * spinMag, wy: tHatY * b * spinMag,
      // −a: no referencial formal do motor, bater à direita (a>0 na tela) gera
      // wz negativo — que na TELA é o inglês direito real (tabela rebate pro
      // mesmo lado, throw pro lado oposto, squirt pro lado oposto).
      wz: -a * spinMag,
    };
  }

  // ===========================================================================
  // Simulação completa de uma tacada (event-based, roda até tudo parar)
  // ===========================================================================
  function simulateShot(initialBalls) {
    const n = initialBalls.length;
    const cur = initialBalls.map((b) => ({ ...b }));
    for (const b of cur) { if (!b.potted) classify(b); else { b.phase = 'potted'; b.dir = { x: 0, y: 0 }; } }

    function snapshotSeg(b, t0) {
      return {
        t0, phase: b.phase,
        x0: b.x, y0: b.y, vx0: b.vx, vy0: b.vy,
        wx0: b.wx, wy0: b.wy, wz0: b.wz,
        dirx: b.dir ? b.dir.x : 0, diry: b.dir ? b.dir.y : 0,
      };
    }

    const segStart = cur.map((b) => snapshotSeg(b, 0));
    const segments = Array.from({ length: n }, () => []);
    const events = [];
    let tCur = 0;
    let iterations = 0;
    const MAX_ITER = 1500; // até 15 bolas no break geram bastante eventos simultâneos
    const MAX_DURATION = 40; // segundos simulados — trava de segurança (§10)

    function closeAndReopen(i, t) {
      segments[i].push({ ...segStart[i], t1: t });
      segStart[i] = snapshotSeg(cur[i], t);
    }

    while (iterations++ < MAX_ITER && tCur < MAX_DURATION) {
      const moving = cur.some((b) => !b.potted && b.phase !== 'stopped');
      const spinning = cur.some((b) => !b.potted && Math.abs(b.wz) > 1e-3);
      if (!moving && !spinning) break;

      let bestT = Infinity, bestEvent = null;
      const coeffs = cur.map(motionCoeffs);

      // ALCANCE de cada bola: distância máx. que ela ainda percorre até parar
      // (limite superior seguro: v + (2/7)|u| cobre draw/backspin que acelera
      // após reverter). Pré-filtro barato que evita resolver polinômios para
      // geometria inalcançável — essencial com colisores de malha (100+ segs).
      const reach = cur.map((b) => {
        if (b.potted || b.phase === 'stopped') return 0;
        const u = slipVector(b.vx, b.vy, b.wx, b.wy);
        const vmax = Math.hypot(b.vx, b.vy) + (2 / 7) * Math.hypot(u.x, u.y);
        return (vmax * vmax) / (2 * MU_ROLL * G) + 6;
      });

      for (let i = 0; i < n; i++) {
        if (cur[i].potted || cur[i].phase === 'stopped') continue;
        const t = transitionTime(cur[i]);
        if (t < bestT) { bestT = t; bestEvent = { type: 'transition', i }; }
      }
      for (let i = 0; i < n; i++) {
        if (cur[i].potted || cur[i].phase === 'stopped') continue;
        const bi = cur[i], ri = reach[i];
        // Rails e chanfros (segmentos) — seguram o centro da bola em toda a
        // volta, MENOS nas bocas das caçapas.
        for (const seg of ALL_WALLS) {
          const ddx = Math.max(seg.minx - bi.x, 0, bi.x - seg.maxx);
          const ddy = Math.max(seg.miny - bi.y, 0, bi.y - seg.maxy);
          if (ddx * ddx + ddy * ddy > ri * ri) continue; // inalcançável
          const t = segTime(coeffs[i], seg);
          if (t < bestT) { bestT = t; bestEvent = { type: 'wall', i, seg }; }
        }
        // Pontas dos rails (jaws) — colisão com o vértice.
        for (const tip of TIPS) {
          const dtx = tip.x - bi.x, dty = tip.y - bi.y;
          const lim = ri + R;
          if (dtx * dtx + dty * dty > lim * lim) continue;
          const phantom = { x0: tip.x, y0: tip.y, vx0: 0, vy0: 0, ax: 0, ay: 0 };
          const t = approachTime(coeffs[i], phantom, R);
          if (t < bestT) { bestT = t; bestEvent = { type: 'tip', i, tip }; }
        }
        // Captura por círculo na BOCA (nos dois modos): a bola cai quando o
        // centro passa sobre o buraco — como numa mesa real, onde ela despenca
        // na boca em vez de precisar viajar até o fundo da garganta.
        for (const p of PCAPS) {
          const dpx = p.x - bi.x, dpy = p.y - bi.y;
          const lim = ri + p.cap;
          if (dpx * dpx + dpy * dpy > lim * lim) continue;
          const t = approachTime(coeffs[i], { x0: p.x, y0: p.y, vx0: 0, vy0: 0, ax: 0, ay: 0 }, p.cap);
          if (t < bestT) { bestT = t; bestEvent = { type: 'escape', i }; }
        }
        if (customTable) {
          // Colisor de modelo: rede de segurança externa generosa.
          const M = 45;
          const esc = Math.min(
            boundTime(coeffs[i], true, -M), boundTime(coeffs[i], true, W + M),
            boundTime(coeffs[i], false, -M), boundTime(coeffs[i], false, H + M));
          if (esc < bestT) { bestT = esc; bestEvent = { type: 'escape', i }; }
        } else {
          // Geometria analítica (2D): backstop — centro cruzou o FUNDO da boca
          // (CAPD além da borda) sem passar pelo círculo? Cai do mesmo jeito.
          const cap = Math.min(
            boundTime(coeffs[i], true, -CAPD), boundTime(coeffs[i], true, W + CAPD),
            boundTime(coeffs[i], false, -CAPD), boundTime(coeffs[i], false, H + CAPD));
          if (cap < bestT) { bestT = cap; bestEvent = { type: 'escape', i }; }
        }
      }
      for (let i = 0; i < n; i++) {
        if (cur[i].potted) continue;
        for (let j = i + 1; j < n; j++) {
          if (cur[j].potted) continue;
          if (cur[i].phase === 'stopped' && cur[j].phase === 'stopped') continue;
          const dbx = cur[j].x - cur[i].x, dby = cur[j].y - cur[i].y;
          const lim = reach[i] + reach[j] + 2 * R;
          if (dbx * dbx + dby * dby > lim * lim) continue; // par inalcançável
          const t = approachTime(coeffs[i], coeffs[j], 2 * R);
          if (t < bestT) { bestT = t; bestEvent = { type: 'ballball', i, j }; }
        }
      }

      if (!bestEvent || bestT === Infinity) break;

      for (let i = 0; i < n; i++) advance(cur[i], bestT);
      tCur += bestT;

      if (bestEvent.type === 'transition') {
        resolveTransition(cur[bestEvent.i]);
        closeAndReopen(bestEvent.i, tCur);
      } else if (bestEvent.type === 'ballball') {
        const { i, j } = bestEvent;
        const A = cur[i], B = cur[j];
        const ddx = B.x - A.x, ddy = B.y - A.y, LL = Math.hypot(ddx, ddy) || 1e-9;
        const nnx = ddx / LL, nny = ddy / LL;
        const vimp = Math.abs((A.vx - B.vx) * nnx + (A.vy - B.vy) * nny); // aprox. normal
        resolveBallBall(A, B);
        events.push({ t: tCur, type: 'contact', a: A.n, b: B.n, v: vimp });
        closeAndReopen(i, tCur); closeAndReopen(j, tCur);
      } else if (bestEvent.type === 'wall') {
        const { i, seg } = bestEvent;
        const b = cur[i];
        const vimp = Math.abs(b.vx * seg.nx + b.vy * seg.ny);
        resolveWall(b, seg.nx, seg.ny, !!seg.jaw);
        events.push({ t: tCur, type: 'cushion', n: b.n, v: vimp });
        closeAndReopen(i, tCur);
      } else if (bestEvent.type === 'tip') {
        const { i, tip } = bestEvent;
        const b = cur[i];
        let ddx = b.x - tip.x, ddy = b.y - tip.y; const dd = Math.hypot(ddx, ddy) || 1e-6;
        const vimp = Math.abs(b.vx * (ddx / dd) + b.vy * (ddy / dd));
        resolveTip(b, tip);
        events.push({ t: tCur, type: 'cushion', n: b.n, v: vimp });
        closeAndReopen(i, tCur);
      } else if (bestEvent.type === 'pocket' || bestEvent.type === 'escape') {
        const { i } = bestEvent;
        if (bestEvent.type === 'escape') {
          // encaçapa na caçapa mais próxima (a bola estava saindo da mesa)
          let bx = 0, by = 0, bd = Infinity;
          for (const p of PCAPS) { const d = Math.hypot(cur[i].x - p.x, cur[i].y - p.y); if (d < bd) { bd = d; bx = p.x; by = p.y; } }
          cur[i].x = bx; cur[i].y = by;
        }
        cur[i].potted = true;
        cur[i].vx = 0; cur[i].vy = 0; cur[i].wx = 0; cur[i].wy = 0; cur[i].wz = 0;
        cur[i].phase = 'potted';
        events.push({ t: tCur, type: cur[i].n === 0 ? 'cuepotted' : 'pocket', n: cur[i].n });
        closeAndReopen(i, tCur);
      }
    }

    // Sanitização final: nada de NaN nem bola fora da mesa (defesa extra).
    for (const b of cur) {
      if (b.potted) continue;
      if (!isFinite(b.x) || !isFinite(b.y) ||
          b.x < -2 || b.x > W + 2 || b.y < -2 || b.y > H + 2) {
        let bx = 0, by = 0, bd = Infinity;
        for (const p of PCAPS) { const dd = Math.hypot((b.x || 0) - p.x, (b.y || 0) - p.y); if (dd < bd) { bd = dd; bx = p.x; by = p.y; } }
        b.x = bx; b.y = by; b.potted = true; b.phase = 'potted';
        b.vx = 0; b.vy = 0; b.wx = 0; b.wy = 0; b.wz = 0;
        events.push({ t: tCur, type: b.n === 0 ? 'cuepotted' : 'pocket', n: b.n });
      }
    }

    // Relaxação das posições de REPOUSO: no aglomerado denso do break, resolver
    // colisões quase-simultâneas com pequenos reposicionamentos pode deixar
    // bolas paradas levemente sobrepostas. Aqui, com tudo já parado, empurramos
    // pares sobrepostos ao longo da linha dos centros e mantemos todos dentro
    // da mesa — ajuste imperceptível que evita bolas visivelmente encavaladas.
    separateOverlaps(cur);

    for (let i = 0; i < n; i++) {
      if (segStart[i].phase !== 'potted') { segStart[i].x0 = cur[i].x; segStart[i].y0 = cur[i].y; }
      closeAndReopen(i, tCur);
    }

    const cueB = initialBalls.find((b) => b.n === 0);
    const cueSpeed = cueB ? Math.hypot(cueB.vx || 0, cueB.vy || 0) : 0;
    return {
      duration: tCur,
      segments,
      events,
      cueSpeed,
      finalBalls: cur.map((b) => ({ n: b.n, x: b.x, y: b.y, potted: b.potted })),
    };
  }

  // Empurra pares sobrepostos até a distância 2R e mantém dentro dos limites.
  function separateOverlaps(balls) {
    const minX = R, maxX = W - R, minY = R, maxY = H - R;
    // Na BOCA da caçapa o centro pode ficar legitimamente além da linha dos
    // rails (bola "pendurada" nos chanfros). Clampar essa bola de volta ao
    // retângulo a teleportava para cima do rail — e podia sobrepô-la a outra.
    const nearPocket = (b) => PCAPS.some((p) => Math.hypot(b.x - p.x, b.y - p.y) < p.cap + 2.5 * R);
    for (let iter = 0; iter < 30; iter++) {
      let moved = false;
      for (let i = 0; i < balls.length; i++) {
        if (balls[i].potted) continue;
        for (let j = i + 1; j < balls.length; j++) {
          if (balls[j].potted) continue;
          let dx = balls[j].x - balls[i].x, dy = balls[j].y - balls[i].y;
          let d = Math.hypot(dx, dy);
          const overlap = 2 * R - d;
          if (overlap > 1e-4) {
            if (d < 1e-6) { dx = 1; dy = 0; d = 1; } // centros coincidentes
            const nx = dx / d, ny = dy / d, push = overlap / 2 + 1e-3;
            balls[i].x -= nx * push; balls[i].y -= ny * push;
            balls[j].x += nx * push; balls[j].y += ny * push;
            moved = true;
          }
        }
      }
      for (const b of balls) {
        if (b.potted || nearPocket(b)) continue;
        b.x = Math.max(minX, Math.min(maxX, b.x));
        b.y = Math.max(minY, Math.min(maxY, b.y));
      }
      if (!moved) break;
    }
  }

  // Avalia uma bola no instante t dentro de um segmento (para playback).
  function evalSegment(seg, tAbs) {
    const tau = Math.max(0, tAbs - seg.t0);
    if (seg.phase === 'potted') return { x: seg.x0, y: seg.y0, potted: true };
    if (seg.phase === 'stopped') return { x: seg.x0, y: seg.y0, potted: false };
    const decel = seg.phase === 'slide' ? MU_SLIDE * G : MU_ROLL * G;
    const x = seg.x0 + seg.vx0 * tau - 0.5 * decel * tau * tau * seg.dirx;
    const y = seg.y0 + seg.vy0 * tau - 0.5 * decel * tau * tau * seg.diry;
    return { x, y, potted: false };
  }

  // Avalia TODAS as bolas no instante t (usado tanto por quem atirou quanto
  // pelo espectador, que só faz playback — sem re-simular nada).
  function evaluateShotAt(segments, tAbs, fallback) {
    return segments.map((segList, i) => {
      if (!segList.length) return fallback[i];
      let seg = segList[segList.length - 1];
      for (const s of segList) { if (tAbs < s.t1) { seg = s; break; } }
      return evalSegment(seg, Math.min(tAbs, seg.t1));
    });
  }

  // Geometria da mesa para o RENDER (coordenadas do centro de contato). O
  // desenho deve refletir exatamente onde a física coloca rails/chanfros/buracos.
  const wallOut = (s) => ({ ax: s.ax, ay: s.ay, bx: s.bx, by: s.by, nx: s.nx, ny: s.ny });
  const TABLE = {
    walls: ALL_WALLS.map(wallOut),
    rails: SEGMENTS.map(wallOut),   // só os 6 rails retos (para desenhar as almofadas)
    tips: TIPS.map((t) => ({ x: t.x, y: t.y })),
    pockets: PCAPS.map((p) => ({ x: p.x, y: p.y, cap: p.cap })),
    R, CT, MT, CHF,
  };

  return { simulateShot, evaluateShotAt, cueStrike, squirtedDir, MAX_OFFSET, TABLE, setTable };
})();
