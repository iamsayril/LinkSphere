'use strict';

/**
 * call.routes.js
 * All voice/video call endpoints for LinkSphere.
 *
 * Note: /livekit-webhook uses express.raw() so LiveKit's
 * signature verification receives the raw body bytes.
 */

const express = require('express');
const router  = express.Router();

const {
  startCall,
  joinCall,
  leaveCall,
  endCall,
  getCallParticipants,
  muteParticipant,
  getActiveCall,
  getCallHistory,
  livekitWebhook,
  startDmCall,
  endDmCall,
} = require('../controllers/callController');

const { AccessToken } = require('livekit-server-sdk');

const { authenticate }          = require('../middleware/authMiddleware');
const { requireWorkspaceAdmin } = require('../middleware/authMiddleware');

// ── LiveKit webhook — no auth, raw body, signature verified inside controller
router.post(
  '/livekit-webhook',
  express.raw({ type: 'application/webhook+json' }),
  livekitWebhook
);

// ── LiveKit token — generate a JWT for the client to connect
// ── LiveKit token — generate a JWT for the client to connect
router.post('/token', authenticate, async (req, res) => {
  const { roomName, participantName, metadata } = req.body;  // ← add metadata

  if (!roomName || !participantName) {
    return res.status(400).json({ error: 'roomName and participantName are required' });
  }

  try {
    const token = new AccessToken(
      process.env.LIVEKIT_API_KEY,
      process.env.LIVEKIT_API_SECRET,
      { 
        identity: participantName, 
        ttl: '1h',
        metadata: metadata || '',  // ← add this
      }
    );

    token.addGrant({
      roomJoin: true,
      room: roomName,
      canPublish: true,
      canSubscribe: true,
    });

    res.json({
      token: await token.toJwt(),
      serverUrl: process.env.LIVEKIT_URL,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// All routes below require a valid JWT
router.use(authenticate);

// ── Channel-scoped ─────────────────────────────────────────────────────────
// REQ-16: active call indicator for a channel
router.get('/channel/:channelId/active',  getActiveCall);
// Call history for a channel
router.get('/channel/:channelId/history', getCallHistory);

// ── Call lifecycle ─────────────────────────────────────────────────────────
// REQ-12: start a call
router.post('/',                startCall);
// REQ-12, REQ-16: join an active call
router.post('/:callId/join',    joinCall);
// Leave a call (self)
// Leave a call (self)
router.post('/:callId/leave', (req, res, next) => {
  // support token from query string (for sendBeacon on page close)
  if (!req.headers.authorization && req.query.token) {
    req.headers.authorization = `Bearer ${req.query.token}`;
  }
  next();
}, authenticate, leaveCall);
// REQ-17: end call (host or admin)
router.post('/:callId/end',     endCall);

// ── Participants ───────────────────────────────────────────────────────────
// REQ-15: list participants with live LiveKit state
router.get('/:callId/participants',                          getCallParticipants);
// REQ-17: force-mute a participant (host / admin)
router.post('/:callId/participants/:targetUserId/mute',      muteParticipant);

// ── DM Call routes ─────────────────────────────────────────────────────────
router.post('/dm',         authenticate, startDmCall);
router.post('/dm/:dmCallId/end', authenticate, endDmCall);
module.exports = router;