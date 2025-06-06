const express = require('express');
const http = require('http');
const socketIo = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = socketIo(server);

app.use(express.static('public'));

io.on('connection', socket => {
  console.log('User connected:', socket.id);

  socket.on('locationUpdate', data => {
    // Broadcast ke semua user kecuali pengirim
    socket.broadcast.emit('userMoved', { id: socket.id, ...data });
  });

  socket.on('disconnect', () => {
    io.emit('userDisconnected', socket.id);
  });
});

server.listen(3000, () => {
  console.log('Server jalan di http://localhost:3000');
});
