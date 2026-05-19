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

  // ── Voice Channel Events ─────────────────────────────────────────────────

  socket.on('register', ({ userId }) => {
    socket.userId = userId;
    socket.join(`user:${userId}`);
    console.log(`🎙️ Registered user: ${userId}`);
  });

  socket.on('voice_member_joined', (data) => {
    const { channelId, userId, userName, avatar_url } = data;
    console.log(`🎙️ ${userName} joined voice channel: ${channelId}`);

    // Track on socket for persistence
    socket.voiceChannelId = channelId;
    socket.voiceUser = { user_id: userId, name: userName, avatar_url: avatar_url || null, muted: false };

    // Join a dedicated voice room so we can query members
    socket.join(`voice:${channelId}`);

    // Broadcast to everyone else in the channel
    socket.to(channelId).emit('voice_member_joined', { channelId, userId, userName, avatar_url });
  });

  socket.on('voice_member_left', (data) => {
    const { channelId, userId } = data;
    console.log(`🚪 ${userId} left voice channel: ${channelId}`);

    socket.voiceChannelId = null;
    socket.voiceUser = null;
    socket.leave(`voice:${channelId}`);

    socket.to(channelId).emit('voice_member_left', { channelId, userId });
  });

  socket.on('voice_member_mute_changed', (data) => {
    const { channelId, userId, muted } = data;
    socket.to(channelId).emit('voice_member_mute_changed', { channelId, userId, muted });
  });

  socket.on('voice_member_camera_changed', (data) => {
    const { channelId, userId, cameraOn } = data;
    socket.to(channelId).emit('voice_member_camera_changed', { channelId, userId, cameraOn });
  });

  // WebRTC Signaling
  socket.on('webrtc_offer', (data) => {
    const { toUserId, ...rest } = data;
    io.to(`user:${toUserId}`).emit('webrtc_offer', { ...rest, fromUserId: socket.userId });
  });

  socket.on('webrtc_answer', (data) => {
    const { toUserId, ...rest } = data;
    io.to(`user:${toUserId}`).emit('webrtc_answer', { ...rest, fromUserId: socket.userId });
  });

  socket.on('webrtc_ice_candidate', (data) => {
    const { toUserId, ...rest } = data;
    io.to(`user:${toUserId}`).emit('webrtc_ice_candidate', { ...rest, fromUserId: socket.userId });
  });

  socket.on('webrtc_request_offer', (data) => {
    const { toUserId, ...rest } = data;
    io.to(`user:${toUserId}`).emit('webrtc_request_offer', { ...rest, fromUserId: socket.userId });
  });

  socket.on('disconnect', () => {
    console.log(`❌ Socket disconnected: ${socket.id}`);

    // Auto-remove from voice channel if they disconnect without leaving
    if (socket.voiceChannelId && socket.voiceUser) {
      socket.to(socket.voiceChannelId).emit('voice_member_left', {
        channelId: socket.voiceChannelId,
        userId: socket.voiceUser.user_id,
      });
    }
  });
});

server.listen(PORT, () => {
  console.log(`✅ Server running on port ${PORT}`);
  console.log(`🔗 Health: http://localhost:${PORT}/health`);
});