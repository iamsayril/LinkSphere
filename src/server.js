require('dotenv').config();

const http = require('http');
const { Server } = require('socket.io');
const app = require('./app');

const PORT = process.env.PORT || 3000;

const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: [
      'http://127.0.0.1:5500',
      'http://localhost:5500',
      'http://127.0.0.1:3000',
      'http://localhost:3000',
      'https://linksphere-frontend.netlify.app',
      'https://link-sphere-frontend-zeta.vercel.app',  // ← add this
      process.env.CORS_ORIGIN,
    ].filter(Boolean),
    methods: ['GET', 'POST'],
    credentials: true,
  }
});

app.set('io', io);

// Socket.io
io.on('connection', (socket) => {
  console.log(`🔌 Socket connected: ${socket.id}`);

  // User room for real-time notifications
  socket.on('join_user_room', (userId) => {
    socket.join(`user:${userId}`);
    console.log(`👤 ${socket.id} joined user room: ${userId}`);
  });

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

  // ── Voice Call Events ────────────────────────────────────────────────────

  // Caller initiates a call — forward to receiver's user room
  socket.on('outgoing_call', (data) => {
    const { receiverId, callerName, callerId, roomName } = data;
    console.log(`📞 Call from ${callerId} to ${receiverId}, room: ${roomName}`);

    io.to(`user:${receiverId}`).emit('incoming_call', {
      caller: callerName,
      callerId,
      roomName,
    });
  });

  // Receiver accepted — forward roomName back to caller's user room
  socket.on('call_accepted', (data) => {
    const { callerId, roomName } = data;
    console.log(`✅ Call accepted, notifying caller: ${callerId}`);

    io.to(`user:${callerId}`).emit('call_accepted', {
      roomName,
    });
  });

  // Receiver declined — notify caller
  socket.on('call_declined', (data) => {
    const { callerId } = data;
    console.log(`❌ Call declined, notifying caller: ${callerId}`);

    io.to(`user:${callerId}`).emit('call_rejected');
  });

  // Caller cancelled before receiver answered — notify receiver
  socket.on('call_cancelled_by_initiator', (data) => {
    const { receiverId } = data;
    console.log(`🚫 Call cancelled, notifying receiver: ${receiverId}`);

    io.to(`user:${receiverId}`).emit('call_cancelled');
  });

  // ────────────────────────────────────────────────────────────────────────

  socket.on('disconnect', () => {
    console.log(`❌ Socket disconnected: ${socket.id}`);
  });
});

server.listen(PORT, () => {
  console.log(`✅ Server running on port ${PORT}`);
  console.log(`🔗 Health: http://localhost:${PORT}/health`);
});