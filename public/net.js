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

window.OrbitNet = {
  mode: 'p2p',
  _onMsg: null, _myName: '', _oppName: '',
  _ws: null, _peer: null, _conn: null,

  // Gera um código de sala curto e legível (sem caracteres ambíguos).
  makeCode() {
    const abc = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let s = ''; for (let i = 0; i < 4; i++) s += abc[Math.floor(Math.random() * abc.length)];
    return s;
  },

  hostRoom(code, name, onMsg) { this._begin(name, onMsg); if (this.mode === 'server') this._wsJoin(code); else this._p2pHost(code); },
  joinRoom(code, name, onMsg) { this._begin(name, onMsg); if (this.mode === 'server') this._wsJoin(code); else this._p2pJoin(code); },

  _begin(name, onMsg) {
    this.mode = /[?&]server\b/.test(location.search) ? 'server' : 'p2p';
    this._myName = name || 'Jogador'; this._onMsg = onMsg; this._oppName = '';
  },
  _peerId(code) { return 'orbitpool-' + String(code).toLowerCase().replace(/[^a-z0-9]/g, ''); },

  send(obj) {
    if (this.mode === 'server') { if (this._ws && this._ws.readyState === 1) this._ws.send(JSON.stringify(obj)); }
    else { if (this._conn && this._conn.open) { try { this._conn.send(obj); } catch (e) {} } }
  },

  // ---- Servidor WebSocket (modo ?server) ----------------------------------
  _wsJoin(code) {
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    const ws = new WebSocket(`${proto}://${location.host}`);
    this._ws = ws;
    ws.onopen = () => ws.send(JSON.stringify({ t: 'join', room: code, name: this._myName }));
    ws.onmessage = (e) => { let m; try { m = JSON.parse(e.data); } catch (_) { return; } this._onMsg(m); };
    ws.onclose = () => this._onMsg({ t: '_neterror', msg: 'Conexão com o servidor encerrada. Recarregue a página.' });
    ws.onerror = () => this._onMsg({ t: '_neterror', msg: 'Não foi possível conectar ao servidor.' });
  },

  // ---- P2P via PeerJS -----------------------------------------------------
  _p2pHost(code) {
    if (!window.Peer) return this._onMsg({ t: '_neterror', msg: 'A rede P2P (PeerJS) não carregou. Verifique sua conexão/bloqueadores.' });
    const peer = new Peer(this._peerId(code)); this._peer = peer;
    peer.on('open', () => {
      this._onMsg({ t: 'joined', playerNo: 1 });
      this._onMsg({ t: 'waiting' });
      peer.on('connection', (conn) => {
        if (this._conn) { try { conn.close(); } catch (e) {} return; } // sala cheia
        this._setupConn(conn, true);
      });
    });
    peer.on('error', (err) => {
      const t = ((err && err.type) || err) + '';
      if (/unavailable|taken/i.test(t)) this._onMsg({ t: '_neterror', msg: 'Esse código de sala já está em uso. Crie outra sala.' });
      else this._onMsg({ t: '_neterror', msg: 'Erro de rede: ' + t });
    });
  },
  _p2pJoin(code) {
    if (!window.Peer) return this._onMsg({ t: '_neterror', msg: 'A rede P2P (PeerJS) não carregou. Verifique sua conexão/bloqueadores.' });
    const peer = new Peer(); this._peer = peer;
    peer.on('open', () => {
      this._onMsg({ t: 'joined', playerNo: 2 });
      const conn = peer.connect(this._peerId(code), { reliable: true });
      this._setupConn(conn, false);
      setTimeout(() => { if (!this._conn || !this._conn.open) this._onMsg({ t: '_neterror', msg: 'Não encontrei a sala. Confira o código (o host precisa ter criado a sala e estar online).' }); }, 9000);
    });
    peer.on('error', (err) => {
      const t = ((err && err.type) || err) + '';
      if (/peer-unavailable/i.test(t)) this._onMsg({ t: '_neterror', msg: 'Sala não encontrada. Confira o código com o host.' });
      else this._onMsg({ t: '_neterror', msg: 'Erro de rede: ' + t });
    });
  },
  _setupConn(conn, iAmHost) {
    this._conn = conn;
    conn.on('open', () => { try { conn.send({ t: '_hello', name: this._myName }); } catch (e) {} });
    conn.on('data', (m) => {
      if (!m || !m.t) return;
      if (m.t === '_hello') {
        this._oppName = m.name || 'Adversário';
        if (iAmHost) {
          this._onMsg({ t: 'start', opponent: this._oppName, startTurn: 1 });
          try { conn.send({ t: 'start', opponent: this._myName, startTurn: 1 }); } catch (e) {}
        }
        return;
      }
      this._onMsg(m);
    });
    conn.on('close', () => this._onMsg({ t: 'peer_left' }));
    conn.on('error', () => this._onMsg({ t: 'peer_left' }));
  },
};
