/* =========================================================================
   MatchQueue — Durable Object singleton de matchmaking 1v1.
   O jogador conecta via WS; quando há dois na fila, a sala é preparada
   (RankedRoom /prepare) e ambos recebem { t:'matched', room, playerNo }.
   FIFO simples — com pouco volume, esperar pareamento por ELO só
   atrasaria; a fórmula do ELO já compensa diferenças de rating.
   ========================================================================= */
'use strict';

export class MatchQueue {
  constructor(state, env) {
    this.state = state;
    this.env = env;
  }

  waiting() {
    // A fila é o conjunto de sockets abertos com tag 'q', em ordem de chegada.
    return this.state.getWebSockets('q');
  }

  async fetch(request) {
    const url = new URL(request.url);
    if (url.pathname !== '/ws' || request.headers.get('Upgrade') !== 'websocket') {
      return new Response('rota inválida', { status: 404 });
    }
    const user = JSON.parse(request.headers.get('X-User') || 'null');
    if (!user) return new Response('sem identidade', { status: 403 });

    // Mesmo jogador de novo (refresh/aba dupla): remove a entrada antiga.
    for (const ws of this.waiting()) {
      const att = ws.deserializeAttachment();
      if (att && att.id === user.id) { try { ws.close(1000, 'substituído'); } catch (e) {} }
    }

    const pair = new WebSocketPair();
    this.state.acceptWebSocket(pair[1], ['q']);
    pair[1].serializeAttachment({ id: user.id, name: user.name, ts: Date.now() });

    queueMicrotask(() => this.tryMatch());
    return new Response(null, { status: 101, webSocket: pair[0] });
  }

  async tryMatch() {
    const ws = this.waiting()
      .map((s) => ({ s, att: s.deserializeAttachment() }))
      .filter((x) => x.att)
      .sort((a, b) => a.att.ts - b.att.ts);
    // Pareia distintos (id diferente) dois a dois.
    while (ws.length >= 2) {
      const a = ws.shift();
      const bIdx = ws.findIndex((x) => x.att.id !== a.att.id);
      if (bIdx < 0) { this.say(a.s, { t: 'waiting' }); break; }
      const b = ws.splice(bIdx, 1)[0];

      const room = crypto.randomUUID();
      const stub = this.env.RANKED_ROOM.get(this.env.RANKED_ROOM.idFromName(room));
      await stub.fetch('https://do/prepare', {
        method: 'POST',
        body: JSON.stringify({ players: [{ id: a.att.id, name: a.att.name }, { id: b.att.id, name: b.att.name }] }),
      });
      this.say(a.s, { t: 'matched', room, playerNo: 1 });
      this.say(b.s, { t: 'matched', room, playerNo: 2 });
      try { a.s.close(1000, 'pareado'); } catch (e) {}
      try { b.s.close(1000, 'pareado'); } catch (e) {}
    }
    for (const rest of ws) this.say(rest.s, { t: 'waiting' });
  }

  say(ws, obj) { try { ws.send(JSON.stringify(obj)); } catch (e) {} }

  webSocketMessage() { /* fila não recebe mensagens */ }
  webSocketClose() { /* sair da fila = fechar o socket; nada a fazer */ }
  webSocketError(ws) { try { ws.close(1011, 'erro de conexão'); } catch (e) {} }
}
