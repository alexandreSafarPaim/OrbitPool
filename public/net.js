/* =========================================================================
   OrbitPool — camada de rede unificada.
   Padrão: P2P via PeerJS (sem servidor). Opcional: servidor WebSocket com
   ?server na URL. Interface para os clientes 2D e 3D:
     OrbitNet.hostRoom(code, name, onMsg)  → cria a sala (jogador 1 / host)
     OrbitNet.joinRoom(code, name, onMsg)  → entra na sala pelo código (jogador 2)
     OrbitNet.send(obj)
   Protocolo (igual ao servidor): joined, waiting, start, shot, aim, ballcue,
   rematch, peer_left. Pseudo-mensagem local: _neterror.

   No P2P o host reivindica o ID `orbitpool-<código>` no broker gratuito do
   PeerJS; o convidado conecta nesse ID. Depois, tráfego direto entre os dois
   navegadores (sem servidor no meio).
   ========================================================================= */
'use strict';

// Tradução (i18n.js): mensagens de erro visíveis ao usuário.
const NET_T = (k, p) => (window.OrbitI18N ? OrbitI18N.t(k, p) : k);

window.OrbitNet = {
  mode: 'p2p',
  _onMsg: null, _myName: '', _oppName: '',
  _ws: null, _peer: null, _conn: null,
  _isHost: false, _slots: 2, _guests: [], _roster: null, _started: false,

  // Gera um código de sala curto e legível (sem caracteres ambíguos).
  makeCode() {
    const abc = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let s = ''; for (let i = 0; i < 4; i++) s += abc[Math.floor(Math.random() * abc.length)];
    return s;
  },

  // slots: 2 (1v1) ou 4 (2v2). Só o host define; convidados descobrem no 'assign'.
  hostRoom(code, name, onMsg, slots) {
    this._begin(name, onMsg); this._isHost = true; this._slots = slots === 4 ? 4 : 2;
    if (this.mode === 'server') this._wsJoin(code, this._slots); else this._p2pHost(code);
  },
  joinRoom(code, name, onMsg) { this._begin(name, onMsg); this._isHost = false; if (this.mode === 'server') this._wsJoin(code); else this._p2pJoin(code); },

  // ---- RANQUEADO: fila de matchmaking + sala autoritativa (Cloudflare) -----
  // Fluxo: WS na fila -> {t:'matched', room} -> WS na sala. O servidor manda
  // 'start' com o rack oficial; tacadas viram 'shotinput' (ver game3d.js).
  playRanked(token, name, onMsg) {
    this._begin(name, onMsg); this.mode = 'ranked'; this._isHost = false; this._slots = 2;
    this._rkToken = token; this._rkRoom = null; this._rkTries = 0;
    let q;
    try { q = new WebSocket(OrbitRanked.wsBase() + '/ws/queue?token=' + encodeURIComponent(token)); }
    catch (e) { return this._onMsg({ t: '_neterror', msg: NET_T('rk.connFail') }); }
    this._ws = q;
    q.onmessage = (e) => {
      let m; try { m = JSON.parse(e.data); } catch (_) { return; }
      if (m.t === 'matched') { this._rkRoom = m.room; try { q.close(1000, 'pareado'); } catch (_) {} this._rkConnect(); }
      else this._onMsg(m); // waiting etc.
    };
    // 401 (sem login) chega como close/erro antes de qualquer mensagem.
    q.onerror = () => { if (!this._rkRoom && !this._closing) this._onMsg({ t: '_neterror', msg: NET_T('rk.authFail') }); };
    q.onclose = () => { if (!this._rkRoom && !this._closing) this._onMsg({ t: '_neterror', msg: NET_T('net.closed') }); };
  },
  _rkConnect() {
    let ws;
    try { ws = new WebSocket(OrbitRanked.wsBase() + '/ws/room/' + this._rkRoom + '?token=' + encodeURIComponent(this._rkToken)); }
    catch (e) { return this._onMsg({ t: '_neterror', msg: NET_T('rk.connFail') }); }
    this._ws = ws;
    ws.onopen = () => { this._rkTries = 0; };
    ws.onmessage = (e) => { let m; try { m = JSON.parse(e.data); } catch (_) { return; } this._onMsg(m); };
    ws.onclose = () => {
      if (this._closing || this.mode !== 'ranked') return;
      // O servidor segura a vaga por 60s — tenta voltar (rede móvel oscila).
      if (this._started && this._rkTries < 5) {
        this._rkTries++;
        setTimeout(() => { if (!this._closing && this.mode === 'ranked') this._rkConnect(); }, 1200 * this._rkTries);
      } else if (!this._started) {
        this._onMsg({ t: '_neterror', msg: NET_T('net.closed') });
      }
    };
  },

  _begin(name, onMsg) {
    this.mode = /[?&]server\b/.test(location.search) ? 'server' : 'p2p';
    this._myName = name || NET_T('hud.player'); this._onMsg = onMsg; this._oppName = '';
    this._guests = []; this._roster = null; this._started = false;
  },
  _peerId(code) { return 'orbitpool-' + String(code).toLowerCase().replace(/[^a-z0-9]/g, ''); },

  // Marca que a partida começou (o host chama ao enviar 'start' — muda o
  // tratamento de desconexões: antes = atualizar lobby, depois = peer_left).
  markStarted() { this._started = true; },

  // Sai/fecha a sala SEM recarregar a página (host avisa antes de derrubar).
  leave() {
    this._closing = true;
    try {
      if (this._isHost && this.mode === 'server' && this._ws && this._ws.readyState === 1) {
        try { this._ws.send(JSON.stringify({ t: 'roomclosed' })); } catch (e) {}
      }
      if (this._isHost) for (const g of this._guests) { if (g.open) { try { g.send({ t: 'roomclosed' }); } catch (e) {} } }
      if (this._conn) { try { this._conn.close(); } catch (e) {} }
      if (this._peer) { try { this._peer.destroy(); } catch (e) {} }
      if (this._ws) { try { this._ws.close(); } catch (e) {} }
    } catch (e) {}
    this._peer = null; this._conn = null; this._ws = null;
    this._guests = []; this._roster = null; this._started = false;
    this._lost = {}; this._isHost = false; this._rkRoom = null; this._rkToken = null;
    setTimeout(() => { this._closing = false; }, 300);
  },

  send(obj) {
    if (this.mode === 'server' || this.mode === 'ranked') { if (this._ws && this._ws.readyState === 1) this._ws.send(JSON.stringify(obj)); return; }
    if (this._isHost) { // host = hub: repassa a todos os convidados
      for (const g of this._guests) { if (g.open) { try { g.send(obj); } catch (e) {} } }
    } else if (this._conn && this._conn.open) { try { this._conn.send(obj); } catch (e) {} }
  },

  // ---- Servidor WebSocket (modo ?server) ----------------------------------
  _wsJoin(code, slots) {
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    const ws = new WebSocket(`${proto}://${location.host}`);
    this._ws = ws;
    ws.onopen = () => ws.send(JSON.stringify({ t: 'join', room: code, name: this._myName, slots: slots || undefined }));
    ws.onmessage = (e) => { let m; try { m = JSON.parse(e.data); } catch (_) { return; } this._onMsg(m); };
    ws.onclose = () => { if (!this._closing) this._onMsg({ t: '_neterror', msg: NET_T('net.closed') }); };
    ws.onerror = () => this._onMsg({ t: '_neterror', msg: NET_T('net.serverFail') });
  },

  // ---- P2P via PeerJS (host = hub em estrela p/ até 4 jogadores) -----------
  _p2pHost(code) {
    if (!window.Peer) return this._onMsg({ t: '_neterror', msg: NET_T('net.noPeer') });
    const peer = new Peer(this._peerId(code)); this._peer = peer;
    this._roster = [{ no: 1, name: this._myName }];
    peer.on('open', () => {
      this._onMsg({ t: 'joined', playerNo: 1, slots: this._slots });
      this._onMsg({ t: 'waiting' });
      this._emitLobby(); // 1v1 e 2v2: todo mundo passa pelo lobby da sala
      peer.on('connection', (conn) => {
        // Partida rolando: aceita e decide no _hello (pode ser reconexão em
        // vaga OU substituição de conexão zumbi — só dá pra saber pelo nome).
        const canJoin = this._started || this._guests.length < this._slots - 1;
        if (!canJoin) {
          conn.on('open', () => { try { conn.send({ t: 'full' }); conn.close(); } catch (e) {} });
          return;
        }
        this._setupHostConn(conn);
      });
    });
    peer.on('error', (err) => {
      const t = ((err && err.type) || err) + '';
      if (/unavailable|taken/i.test(t)) this._onMsg({ t: '_neterror', msg: NET_T('net.codeTaken') });
      else this._onMsg({ t: '_neterror', msg: NET_T('net.error', { err: t }) });
    });
  },
  _nextNo() { // menor playerNo livre (2..slots)
    for (let no = 2; no <= this._slots; no++) if (!this._roster.some((p) => p.no === no)) return no;
    return 0;
  },
  _emitLobby() {
    const m = { t: 'lobby', players: this._roster.slice(), slots: this._slots };
    this._onMsg(m);
    for (const g of this._guests) { if (g.open) { try { g.send(m); } catch (e) {} } }
  },
  _setupHostConn(conn) {
    conn.on('data', (m) => {
      if (!m || !m.t) return;
      if (m.t === '_hello') {
        if (conn._no) return; // hello duplicado
        let no = 0;
        if (this._started) {
          // RECONEXÃO em partida andando: 1º tenta vaga de quem caiu (prefere
          // o MESMO nome); 2º, se não há vaga, procura uma conexão ZUMBI com o
          // mesmo nome (celular que fechou sem avisar) e a substitui.
          const lost = Object.entries(this._lost || {});
          const byName = lost.find(([, nm]) => nm === (m.name || ''));
          if (byName || lost.length) {
            no = +(byName ? byName[0] : lost[0][0]);
            delete this._lost[no];
          } else {
            const dup = this._guests.find((g) => g._name === (m.name || ''));
            if (dup) {
              no = dup._no;
              this._guests = this._guests.filter((g) => g !== dup);
              this._roster = this._roster.filter((p) => p.no !== no);
              dup._replaced = true; // não gerar peer_left/vaga ao fechar
              try { dup.close(); } catch (e) {}
            }
          }
          if (!no) { try { conn.send({ t: 'full' }); conn.close(); } catch (e) {} return; }
        } else {
          no = this._nextNo();
          if (!no) { try { conn.send({ t: 'full' }); conn.close(); } catch (e) {} return; }
        }
        conn._no = no; conn._name = (m.name || 'Jogador').slice(0, 20);
        this._guests.push(conn);
        this._roster.push({ no, name: conn._name });
        try { conn.send({ t: 'assign', playerNo: no, slots: this._slots }); } catch (e) {}
        if (this._started) {
          // avisa todo mundo: quem tem o menor nº manda o snapshot (resync)
          const msg = { t: 'rejoined', no, name: conn._name };
          this._onMsg(msg);
          for (const g of this._guests) { if (g !== conn && g.open) { try { g.send(msg); } catch (e) {} } }
        } else {
          this._emitLobby(); // 1v1 e 2v2: lobby da sala (host dá o start)
        }
        return;
      }
      // Relay em estrela: entrega local + repassa aos demais convidados.
      const out = { ...m, from: conn._no || 0 };
      this._onMsg(out);
      for (const g of this._guests) { if (g !== conn && g.open) { try { g.send(out); } catch (e) {} } }
    });
    const drop = () => this._dropGuest(conn);
    conn.on('close', drop);
    conn.on('error', drop);
  },
  _dropGuest(conn) {
    if (conn._replaced) return; // foi trocada por uma reconexão — nada a fazer
    const i = this._guests.indexOf(conn);
    if (i < 0) return;
    this._guests.splice(i, 1);
    this._roster = this._roster.filter((p) => p.no !== conn._no);
    if (this._started) {
      // guarda a vaga p/ reconexão pelo código da sala
      this._lost = this._lost || {};
      this._lost[conn._no] = conn._name || '';
      const m = { t: 'peer_left', no: conn._no };
      this._onMsg(m);
      for (const g of this._guests) { if (g.open) { try { g.send(m); } catch (e) {} } }
    } else {
      this._emitLobby(); // ainda no lobby (1v1 ou 2v2): só atualiza a lista
    }
  },
  _p2pJoin(code) {
    if (!window.Peer) return this._onMsg({ t: '_neterror', msg: NET_T('net.noPeer') });
    const peer = new Peer(); this._peer = peer;
    peer.on('open', () => {
      const conn = peer.connect(this._peerId(code), { reliable: true });
      this._conn = conn;
      conn.on('open', () => { try { conn.send({ t: '_hello', name: this._myName }); } catch (e) {} });
      conn.on('data', (m) => { if (m && m.t) this._onMsg(m); });
      conn.on('close', () => { if (!this._closing) this._onMsg({ t: 'peer_left' }); });
      conn.on('error', () => { if (!this._closing) this._onMsg({ t: 'peer_left' }); });
      setTimeout(() => {
        // 10s sem conectar: desiste, limpa e libera para tentar de novo.
        // Só age se ESTA tentativa ainda for a atual (o jogador pode já ter
        // cancelado ou iniciado outra — não pode derrubar a nova conexão).
        if (this._conn !== conn || conn.open) return;
        this.leave();
        this._onMsg({ t: '_neterror', msg: NET_T('net.notFound') });
      }, 10000);
    });
    peer.on('error', (err) => {
      const t = ((err && err.type) || err) + '';
      if (/peer-unavailable/i.test(t)) this._onMsg({ t: '_neterror', msg: NET_T('net.notFound') });
      else this._onMsg({ t: '_neterror', msg: NET_T('net.error', { err: t }) });
    });
  },
};
