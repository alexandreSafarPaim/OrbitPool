// Bilhar Multiplayer — servidor HTTP + WebSocket em Node puro (sem dependências).
// Serve os arquivos estáticos de /public e faz o relay das mensagens entre os
// dois jogadores de cada sala (room). A física roda só no cliente de quem
// está com a vez ("shooter"), que calcula a tacada inteira de uma vez
// (motor event-based) e transmite a timeline pronta; o adversário só faz
// playback — por isso não há sincronização contínua de estado, só uma
// mensagem 'shot' por tacada.

const http = require('http');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 3000;
const PUBLIC_DIR = path.join(__dirname, 'public');
const WS_GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.ogg': 'audio/ogg',
  '.obj': 'text/plain; charset=utf-8',
};

// ---------------------------------------------------------------------------
// Servidor HTTP (arquivos estáticos)
// ---------------------------------------------------------------------------
const server = http.createServer((req, res) => {
  let urlPath = decodeURIComponent(req.url.split('?')[0]);
  if (urlPath === '/') urlPath = '/index.html';

  const filePath = path.join(PUBLIC_DIR, path.normalize(urlPath));
  if (!filePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403);
    return res.end('Forbidden');
  }

  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404);
      return res.end('Not found');
    }
    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
    res.end(data);
  });
});

// ---------------------------------------------------------------------------
// WebSocket mínimo (handshake + framing de texto)
// ---------------------------------------------------------------------------
let nextId = 1;
const rooms = new Map(); // roomId -> { clients: Set<Conn> }

function makeRoom(id, slots) {
  const room = { id, clients: new Set(), slots: slots === 4 ? 4 : 2, started: false };
  rooms.set(id, room);
  return room;
}

class Conn {
  constructor(socket) {
    this.socket = socket;
    this.id = nextId++;
    this.buffer = Buffer.alloc(0);
    this.room = null;
    this.playerNo = 0;
    this.name = '';
    this.alive = true;
  }

  send(obj) {
    if (!this.alive) return;
    const payload = Buffer.from(JSON.stringify(obj));
    const len = payload.length;
    let header;
    if (len < 126) {
      header = Buffer.from([0x81, len]);
    } else if (len < 65536) {
      header = Buffer.alloc(4);
      header[0] = 0x81;
      header[1] = 126;
      header.writeUInt16BE(len, 2);
    } else {
      header = Buffer.alloc(10);
      header[0] = 0x81;
      header[1] = 127;
      header.writeUInt32BE(0, 2);
      header.writeUInt32BE(len, 6);
    }
    try {
      this.socket.write(Buffer.concat([header, payload]));
    } catch (e) {
      /* socket morto */
    }
  }

  close() {
    if (!this.alive) return;
    this.alive = false;
    try { this.socket.end(); } catch (e) {}
    leaveRoom(this);
  }
}

server.on('upgrade', (req, socket) => {
  const key = req.headers['sec-websocket-key'];
  if (!key) {
    socket.destroy();
    return;
  }
  const accept = crypto
    .createHash('sha1')
    .update(key + WS_GUID)
    .digest('base64');

  socket.write(
    'HTTP/1.1 101 Switching Protocols\r\n' +
      'Upgrade: websocket\r\n' +
      'Connection: Upgrade\r\n' +
      `Sec-WebSocket-Accept: ${accept}\r\n\r\n`
  );

  const conn = new Conn(socket);

  socket.on('data', (chunk) => {
    conn.buffer = Buffer.concat([conn.buffer, chunk]);
    parseFrames(conn);
  });
  socket.on('close', () => conn.close());
  socket.on('error', () => conn.close());
});

function parseFrames(conn) {
  let buf = conn.buffer;
  while (buf.length >= 2) {
    const opcode = buf[0] & 0x0f;
    const masked = (buf[1] & 0x80) !== 0;
    let len = buf[1] & 0x7f;
    let offset = 2;

    if (len === 126) {
      if (buf.length < 4) break;
      len = buf.readUInt16BE(2);
      offset = 4;
    } else if (len === 127) {
      if (buf.length < 10) break;
      len = Number(buf.readBigUInt64BE(2));
      offset = 10;
    }

    let maskKey;
    if (masked) {
      if (buf.length < offset + 4) break;
      maskKey = buf.slice(offset, offset + 4);
      offset += 4;
    }

    if (buf.length < offset + len) break;

    let payload = buf.slice(offset, offset + len);
    if (masked) {
      const out = Buffer.alloc(len);
      for (let i = 0; i < len; i++) out[i] = payload[i] ^ maskKey[i & 3];
      payload = out;
    }

    buf = buf.slice(offset + len);

    if (opcode === 0x8) {
      // close
      conn.close();
      return;
    } else if (opcode === 0x9) {
      // ping -> pong
      try { conn.socket.write(Buffer.from([0x8a, 0x00])); } catch (e) {}
    } else if (opcode === 0x1 || opcode === 0x0) {
      handleMessage(conn, payload.toString('utf8'));
    }
  }
  conn.buffer = buf;
}

// ---------------------------------------------------------------------------
// Lógica de sala / relay
// ---------------------------------------------------------------------------
function broadcastRoom(room, obj, except) {
  for (const c of room.clients) {
    if (c !== except) c.send(obj);
  }
}

function leaveRoom(conn) {
  const room = conn.room;
  if (!room) return;
  room.clients.delete(conn);
  conn.room = null;
  if (!room.started && room.slots === 4) broadcastLobby(room); // ainda no lobby de times
  else broadcastRoom(room, { t: 'peer_left', no: conn.playerNo });
  if (room.clients.size === 0) rooms.delete(room.id);
}

function broadcastLobby(room) {
  const players = [...room.clients].map((c) => ({ no: c.playerNo, name: c.name }));
  broadcastRoom(room, { t: 'lobby', players, slots: room.slots });
}

function handleMessage(conn, raw) {
  let msg;
  try {
    msg = JSON.parse(raw);
  } catch (e) {
    return;
  }

  switch (msg.t) {
    case 'join': {
      const roomId = (msg.room || 'sala1').toString().slice(0, 24);
      conn.name = (msg.name || 'Jogador').toString().slice(0, 20);
      let room = rooms.get(roomId);
      if (!room) room = makeRoom(roomId, msg.slots | 0); // 1º a entrar (host) define 2 ou 4 vagas

      if (room.clients.size >= room.slots || room.started) {
        conn.send({ t: 'full' });
        return;
      }

      room.clients.add(conn);
      conn.room = room;
      // Menor playerNo livre (1..slots) — estável mesmo se alguém sair do lobby.
      const used = new Set([...room.clients].filter((c) => c !== conn).map((c) => c.playerNo));
      for (let no = 1; no <= room.slots; no++) { if (!used.has(no)) { conn.playerNo = no; break; } }

      conn.send({ t: 'joined', playerNo: conn.playerNo, room: roomId, name: conn.name, slots: room.slots });

      if (room.slots === 2 && room.clients.size === 2) {
        // 1v1: começa direto (comportamento original).
        room.started = true;
        const [a, b] = [...room.clients];
        a.send({ t: 'start', you: a.playerNo, opponent: b.name, startTurn: 1 });
        b.send({ t: 'start', you: b.playerNo, opponent: a.name, startTurn: 1 });
      } else if (room.slots === 4) {
        broadcastLobby(room); // 2v2: lobby de times (o host organiza e envia 'start')
      } else {
        conn.send({ t: 'waiting' });
      }
      break;
    }

    // Demais mensagens de jogo: relay para todos os outros da sala (o shooter
    // é a fonte da verdade; 'start'/'teams' vêm do host no 2v2).
    default: {
      if (!conn.room) break;
      if (msg.t === 'start') conn.room.started = true;
      broadcastRoom(conn.room, { ...msg, from: conn.playerNo }, conn);
      break;
    }
  }
}

server.listen(PORT, () => {
  console.log(`\n🎱  Bilhar rodando em  http://localhost:${PORT}\n`);
  console.log('   Abra em duas abas/dispositivos, entre na mesma sala e jogue!\n');
});
