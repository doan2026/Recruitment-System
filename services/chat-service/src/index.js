const express = require('express');
const { createServer } = require('node:http');
const { Server } = require('socket.io');

const app = express();
const server = createServer(app);
const io = new Server(server, { path: '/socket.io' });

app.get('/health', (_request, response) => response.json({ service: 'chat-service', status: 'UP' }));

io.use((socket, next) => {
  // TODO: verify RS256 JWT from socket.handshake.auth.token using the shared public key.
  next();
});
io.on('connection', (socket) => {
  socket.on('typing', (payload) => socket.broadcast.emit('typing', payload));
  socket.on('message:send', (payload) => socket.broadcast.emit('message:new', payload));
  socket.on('message:seen', (payload) => socket.broadcast.emit('message:seen', payload));
});

server.listen(Number(process.env.PORT ?? 3001), '0.0.0.0');
