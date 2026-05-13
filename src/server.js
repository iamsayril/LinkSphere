require('dotenv').config();

const express = require('express');
const cors = require('cors');
const http = require('http');
const { Server } = require('socket.io');
const { createClient } = require('@supabase/supabase-js');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: process.env.CORS_ORIGIN || '*' }
});

const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.set('io', io);

// Supabase client
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
);

// Routes
app.use('/api/auth', require('./routes/authRoutes'));
app.use('/api/messages', require('./routes/messageRoutes'));
app.use('/api/channels', require('./routes/channelRoutes')); // ← added

// Root
app.get('/', (req, res) => {
  res.json({ message: 'LinkSphere API is running 🚀' });
});

// Health check
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV
  });
});

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