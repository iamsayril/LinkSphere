require('dotenv').config();

const express = require('express');
const cors = require('cors');
const { createClient } = require('@supabase/supabase-js');
const { AccessToken } = require('livekit-server-sdk');

const app = express();

const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

// Supabase client
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
);

// Root route
app.get('/', (req, res) => {
  res.json({
    message: 'LinkSphere API is running 🚀'
  });
});

// Health check route
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    message: 'LiveKit backend is running'
  });
});

// Get all users
app.get('/users', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('users')
      .select('*');

    if (error) {
      return res.status(500).json({
        error: error.message
      });
    }

    res.json(data);

  } catch (err) {
    res.status(500).json({
      error: err.message
    });
  }
});

// Generate LiveKit token
app.post('/getToken', async (req, res) => {
  try {
    const { roomName, participantName } = req.body;

    if (!roomName || !participantName) {
      return res.status(400).json({
        error: 'roomName and participantName are required'
      });
    }

    const apiKey = process.env.LIVEKIT_API_KEY;
    const apiSecret = process.env.LIVEKIT_API_SECRET;

    const at = new AccessToken(apiKey, apiSecret, {
      identity: participantName,
    });

    at.addGrant({
      roomJoin: true,
      room: roomName,
      canPublish: true,
      canSubscribe: true,
    });

    const token = await at.toJwt();

    res.json({
      token,
    });

  } catch (err) {
    res.status(500).json({
      error: err.message
    });
  }
});

// Start server
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});

// helloooo badingdong
// rEASEARCH body (Malik)
// KUNG DILI MU GANA MA CHECK RAMAN SA POSTMAN