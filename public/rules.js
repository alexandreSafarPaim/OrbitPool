/* =========================================================================
   OrbitPool — regras do 8-ball em módulo PURO (sem DOM, i18n, rede ou
   three.js). Roda no navegador (script clássico, global OrbitRules) e no
   servidor (Worker/Durable Object/Node via module.exports) — é o MESMO
   código que valida partidas ranqueadas no servidor autoritativo.

   Contrato de evaluateShot(state, ev):
     state = {
       shooter,                  // playerNo de quem tacou
       turnOrder,                // ex.: [1,2] (1v1) ou [1,3,2,4] (2v2)
       teamOf,                   // (no) → 1|2
       open,                     // mesa aberta?
       groups,                   // { 1: 'solid'|'stripe'|null, 2: ... } por TIME
       balls,                    // [{ n, potted }] estado APÓS aplicar finalBalls
     }
     ev = deriveRuleEvents(shot.events)
   Retorna (NÃO muta state):
     { nextTurn, ballInHand, foul, foulReasons,   // reasons = chaves i18n
       open, groups, gameOver, winner,            // novo estado de regras
       msg }                                      // {key,...} p/ i18n no cliente;
                                                  // msg.fallback=true → só exibir
                                                  // se não houver msg anterior
   ========================================================================= */
'use strict';

const OrbitRules = (function () {
  // Ordem oficial de rack do 8-ball (mesma do cliente/2D).
  const RACK_NUMBERS = [1, 9, 2, 10, 8, 3, 11, 7, 14, 4, 5, 13, 15, 6, 12];

  const isStripe = (n) => n >= 9 && n <= 15;
  function groupName(n) {
    if (n === 8) return 'eight';
    if (n >= 1 && n <= 7) return 'solid';
    if (n >= 9 && n <= 15) return 'stripe';
    return null;
  }

  // Próximo da rotação fixa de tacadas (2v2: alterna time E parceiro).
  function nextTurnAfter(turnOrder, no) {
    const i = turnOrder.indexOf(no);
    return turnOrder[(i + 1) % turnOrder.length];
  }

  // Reduz a timeline de eventos da física ao que as regras precisam:
  // primeiro contato da branca, branca encaçapada e bolas encaçapadas.
  function deriveRuleEvents(events) {
    let firstContact = null, cuePotted = false;
    const potted = [], pottedOrder = [];
    for (const e of events) {
      if (e.type === 'contact' && firstContact === null && (e.a === 0 || e.b === 0)) firstContact = e.a === 0 ? e.b : e.a;
      if (e.type === 'pocket') { potted.push(e.n); pottedOrder.push(e.n); }
      if (e.type === 'cuepotted') cuePotted = true;
    }
    return { firstContact, cuePotted, potted, pottedOrder };
  }

  // Regras do 8-ball (WPA simplificada — idênticas ao comportamento anterior
  // do cliente). GRUPOS, VITÓRIA e FALTAS são por TIME; no 1v1 time == playerNo.
  function evaluateShot(state, ev) {
    const { shooter, turnOrder, teamOf, balls } = state;
    const myTeam = teamOf(shooter), oppTeam = myTeam === 1 ? 2 : 1;
    const nextNo = nextTurnAfter(turnOrder, shooter); // quem joga se a vez passar

    let open = state.open;
    const groups = { 1: state.groups[1], 2: state.groups[2] };
    const remainingOfGroup = (grp) => balls.filter((b) => !b.potted && groupName(b.n) === grp).length;

    let foul = false; const reasons = [];
    if (ev.firstContact === null) { foul = true; reasons.push('foul.noContact'); }
    if (ev.cuePotted) { foul = true; reasons.push('foul.scratch'); }
    if (ev.firstContact !== null) {
      const fc = groupName(ev.firstContact);
      if (open) { if (fc === 'eight') { foul = true; reasons.push('foul.eightFirstOpen'); } }
      else {
        const myGrp = groups[myTeam];
        // Estado ANTES da tacada: balls já vem com as bolas desta tacada
        // marcadas como potted, então soma de volta as do grupo encaçapadas
        // agora. Sem isso, matar a última bola do grupo virava falta.
        const pottedMineNow = ev.potted.filter((n) => groupName(n) === myGrp).length;
        const cleared = remainingOfGroup(myGrp) + pottedMineNow === 0;
        if (cleared) { if (fc !== 'eight') { foul = true; reasons.push('foul.mustHit8'); } }
        else if (fc !== myGrp) { foul = true; reasons.push('foul.wrongGroup'); }
      }
    }

    const numbered = ev.potted.filter((n) => n !== 8);
    const eightPotted = ev.potted.includes(8);
    if (eightPotted) {
      const myGrp = groups[myTeam];
      // Só é legal se o grupo já estava limpo ANTES desta tacada (WPA:
      // encaçapar a última do grupo e a 8 no mesmo golpe é derrota).
      const pottedMineNow = ev.potted.filter((n) => groupName(n) === myGrp).length;
      const clearedBefore = myGrp && remainingOfGroup(myGrp) + pottedMineNow === 0;
      const legal = !foul && !ev.cuePotted && !open && clearedBefore;
      const winner = legal ? myTeam : oppTeam; // vencedor = TIME
      return {
        nextTurn: shooter, ballInHand: false, foul, foulReasons: reasons,
        open, groups, gameOver: true, winner,
        msg: legal ? { key: 'msg.win8', team: myTeam }
                   : { key: 'msg.lose8', shooter, team: oppTeam },
      };
    }

    let continueTurn = false, msg = null;
    if (!foul && open && numbered.length) {
      const first = ev.pottedOrder.find((n) => n !== 8); const grp = groupName(first);
      if (grp === 'solid' || grp === 'stripe') {
        groups[myTeam] = grp; groups[oppTeam] = grp === 'solid' ? 'stripe' : 'solid';
        open = false; continueTurn = true;
        msg = { key: 'msg.groups', team: myTeam, group: grp };
      }
    } else if (!foul && !open && numbered.length) {
      const myGrp = groups[myTeam];
      if (numbered.some((n) => groupName(n) === myGrp)) { continueTurn = true; msg = { key: 'msg.continue', shooter }; }
      else msg = { key: 'msg.oppBall', shooter };
    }

    let nextTurn, bih = false;
    if (foul) { nextTurn = nextNo; bih = true; msg = { key: 'msg.foul', reason: reasons[0], next: nextNo }; }
    else if (continueTurn) nextTurn = shooter;
    else { nextTurn = nextNo; if (!msg) msg = { key: 'msg.turnOf', next: nextNo, fallback: true }; }

    return {
      nextTurn, ballInHand: bih, foul, foulReasons: reasons,
      open, groups, gameOver: false, winner: 0, msg,
    };
  }

  return { RACK_NUMBERS, isStripe, groupName, nextTurnAfter, deriveRuleEvents, evaluateShot };
})();

// Servidor (Worker/Node): export CommonJS; navegador: global lexical + globalThis.
if (typeof module !== 'undefined' && module.exports) module.exports = OrbitRules;
if (typeof globalThis !== 'undefined') globalThis.OrbitRules = OrbitRules;
