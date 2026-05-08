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
} = require('../controllers/call.controller');

const { authenticate }          = require('../middleware/auth.middleware');
const { requireWorkspaceAdmin } = require('../middleware/auth.middleware');

// ── LiveKit webhook — no auth, raw body, signature verified inside controller
router.post(
  '/livekit-webhook',
  express.raw({ type: 'application/webhook+json' }),
  livekitWebhook
);

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
router.post('/:callId/leave',   leaveCall);
// REQ-17: end call (host or admin)
router.post('/:callId/end',     endCall);

// ── Participants ───────────────────────────────────────────────────────────
// REQ-15: list participants with live LiveKit state
router.get('/:callId/participants',                          getCallParticipants);
// REQ-17: force-mute a participant (host / admin)
router.post('/:callId/participants/:targetUserId/mute',      muteParticipant);

module.exports = router;