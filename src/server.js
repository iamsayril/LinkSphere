require('dotenv').config();

const http = require('http');
const { Server } = require('socket.io');
const app = require('./app');

const PORT = process.env.PORT || 3000;

const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: process.env.CORS_ORIGIN || '*' }
});

app.set('io', io);

// Socket.io
io.on('connection', (socket) => {
  console.log(`🔌 Socket connected: ${socket.id}`);

  socket.on('join_channel', (channelId) => {
    socket.join(channelId);
    console.log(`👤 ${socket.id} joined channel: ${channelId}`);
  });

  socket.on('leave_channel', (channelId) => {
    socket.leave(channelId);
    console.log(`👤 ${socket.id} left channel: ${channelId}`);
  });

  socket.on('join_workspace', (workspaceId) => {
    socket.join(`workspace:${workspaceId}`);
    console.log(`👤 ${socket.id} joined workspace: ${workspaceId}`);
  });

  socket.on('leave_workspace', (workspaceId) => {
    socket.leave(`workspace:${workspaceId}`);
  });

  socket.on('typing', ({ channelId, user }) => {
    socket.to(channelId).emit('user_typing', { user, channelId });
  });

  socket.on('stop_typing', ({ channelId, user }) => {
    socket.to(channelId).emit('user_stop_typing', { user, channelId });
  });

  socket.on('disconnect', () => {
    console.log(`❌ Socket disconnected: ${socket.id}`);
  });
});

server.listen(PORT, () => {
  console.log(`✅ Server running on port ${PORT}`);
  console.log(`🔗 Health: http://localhost:${PORT}/health`);
});