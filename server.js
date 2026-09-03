const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const WebSocket = require('ws');

const PORT = process.env.PORT || 3000;
const rooms = new Map();

function send(socket, message) {
  if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message));
}

function broadcast(room, message) {
  room.players.forEach(player => send(player.socket, message));
}

function createRoom(host) {
  let code;
  do code = crypto.randomBytes(3).toString('hex').toUpperCase(); while (rooms.has(code));
  const room = { code, players: [{ socket: host, role: 'host', name: 'Player 1' }] };
  rooms.set(code, room);
  return room;
}

const server = http.createServer((request, response) => {
  const requested = request.url === '/' ? '/index.html' : request.url;
  const filePath = path.join(__dirname, requested.split('?')[0]);
  if (!filePath.startsWith(__dirname)) {
    response.writeHead(403);
    response.end('Forbidden');
    return;
  }
  fs.readFile(filePath, (error, data) => {
    if (error) {
      response.writeHead(404);
      response.end('Not found');
      return;
    }
    const contentType = filePath.endsWith('.html') ? 'text/html; charset=utf-8' : 'application/octet-stream';
    response.writeHead(200, { 'Content-Type': contentType });
    response.end(data);
  });
});

const webSocketServer = new WebSocket.Server({ server });
webSocketServer.on('connection', socket => {
  socket.room = null;
  socket.on('message', raw => {
    let message;
    try { message = JSON.parse(raw); } catch { return; }

    if (message.type === 'create') {
      const room = createRoom(socket);
      socket.room = room;
      send(socket, { type: 'room', code: room.code, role: 'host', players: room.players.map(player => player.name) });
      return;
    }

    if (message.type === 'join') {
      const room = rooms.get(String(message.code || '').toUpperCase());
      if (!room || room.players.length >= 2) {
        send(socket, { type: 'error', message: 'Room not found or already full.' });
        return;
      }
      room.players.push({ socket, role: 'guest', name: 'Player 2' });
      socket.room = room;
      const players = room.players.map(player => player.name);
      room.players.forEach(player => send(player.socket, {
        type: 'room',
        code: room.code,
        role: player.role,
        players
      }));
      return;
    }

    if (!socket.room) return;
    const sender = socket.room.players.find(player => player.socket === socket);
    if (message.type === 'state' && sender?.role === 'host') {
      broadcast(socket.room, message);
      return;
    }
    if (message.type === 'action' && sender) {
      const host = socket.room.players.find(player => player.role === 'host');
      if (host) send(host.socket, { ...message, from: sender.role });
    }
  });

  socket.on('close', () => {
    if (!socket.room) return;
    const room = socket.room;
    room.players = room.players.filter(player => player.socket !== socket);
    broadcast(room, { type: 'peer-left' });
    if (room.players.length === 0) rooms.delete(room.code);
  });
});

server.listen(PORT, () => console.log(`MPL server running at http://localhost:${PORT}`));
