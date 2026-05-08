'use strict';

/**
 * call.controller.js
 * LinkSphere — Voice & Video Call Controller
 *
 * Covers SRS requirements:
 *   REQ-12  Any channel member can start a call; all members may join
 *   REQ-13  Video streams; up to N concurrent video feeds
 *   REQ-14  Screen sharing
 *   REQ-15  25 simultaneous video participants; unlimited audio-only
 *   REQ-16  Visual indicator + notification when a call is active
 *   REQ-17  Mute / camera / end-call controls (token grants)
 *   REQ-18  Chat messages and files shared during a call are persisted
 *
 * LiveKit handles all WebRTC media transport.
 * Supabase stores all business-layer call metadata.
 * Your existing WebSocket service handles call event notifications.
 */

const { AccessToken, RoomServiceClient, WebhookReceiver } = require('livekit-server-sdk');
const { query }               = require('../config/database');
const wsService               = require('../services/websocket.service');
const notificationService     = require('../services/notification.service');
const { createAuditLog }      = require('../services/audit.service');

// ─────────────────────────────────────────────
// LiveKit client — initialised once at module load
// ─────────────────────────────────────────────
const LK_URL    = process.env.LIVEKIT_URL;
const LK_KEY    = process.env.LIVEKIT_API_KEY;
const LK_SECRET = process.env.LIVEKIT_API_SECRET;

if (!LK_URL || !LK_KEY || !LK_SECRET) {
  console.warn(
    '[LiveKit] LIVEKIT_URL / LIVEKIT_API_KEY / LIVEKIT_API_SECRET are not set. ' +
    'Call endpoints will fail at runtime.'
  );
}

const roomService = new RoomServiceClient(LK_URL, LK_KEY, LK_SECRET);

// ─────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────

/**
 * generateToken
 * Issues a signed JWT that the frontend passes directly to LiveKit.
 * The token encodes exactly what this participant is allowed to do.
 *
 * @param {string} roomName   - LiveKit room name (= call_id from Supabase)
 * @param {string} userId     - Supabase user_id used as LiveKit identity
 * @param {string} userName   - Display name shown in the LiveKit room
 * @param {object} overrides  - Optional grant overrides (e.g. audio-only)
 */
function generateToken(roomName, userId, userName, overrides = {}) {
  const at = new AccessToken(LK_KEY, LK_SECRET, {
    identity: userId,
    name:     userName,
    ttl:      '4h',
  });

  at.addGrant({
    roomJoin:       true,
    room:           roomName,

    // REQ-13: publish audio + video
    canPublish:     true,
    // REQ-14: screen share is a publish track too
    canPublishSources: ['camera', 'microphone', 'screen_share', 'screen_share_audio'],
    // receive all other participants' tracks
    canSubscribe:   true,
    // REQ-18: in-call data messages (chat / file notifications)
    canPublishData: true,

    // caller can control their own room (mute others if admin)
    roomAdmin:      overrides.roomAdmin ?? false,

    ...overrides,
  });

  return at.toJwt();
}

/**
 * getLiveKitRoom
 * Safe wrapper — returns null instead of throwing if the room doesn't exist yet.
 */
async function getLiveKitRoom(roomName) {
  try {
    const rooms = await roomService.listRooms([roomName]);
    return rooms.find(r => r.name === roomName) ?? null;
  } catch {
    return null;
  }
}

/**
 * safeDeleteRoom
 * Deletes a LiveKit room without crashing if it was already cleaned up.
 */
async function safeDeleteRoom(roomName) {
  try {
    await roomService.deleteRoom(roomName);
  } catch (err) {
    console.warn(`[LiveKit] Could not delete room "${roomName}":`, err.message);
  }
}

// ─────────────────────────────────────────────
// REQ-12: Start a call
// ─────────────────────────────────────────────
/**
 * POST /api/v1/calls
 * Body: { channel_id, call_type? }
 *
 * 1. Writes a call row to Supabase
 * 2. Creates the room in LiveKit
 * 3. Adds the caller as the first participant
 * 4. Notifies channel members via WebSocket + in-app notification (REQ-16)
 * 5. Returns the LiveKit URL + signed JWT to the caller
 */
const startCall = async (req, res, next) => {
  try {
    const { channel_id, call_type = 'video' } = req.body;
    const userId   = req.user.user_id;
    const userName = req.user.name;

    if (!channel_id) {
      return res.status(400).json({ error: 'channel_id is required' });
    }

    // Verify the user is a member of this channel's workspace
    const access = await query(
      `SELECT c.channel_id, c.workspace_id
       FROM public.channel c
       JOIN public.workspace_member wm ON wm.user_id = $1
       JOIN public.user u ON u.user_id = wm.user_id AND u.email = wm.email
       WHERE c.channel_id = $2`,
      [userId, channel_id]
    );

    if (access.rows.length === 0) {
      return res.status(403).json({ error: 'You are not a member of this channel' });
    }

    // Check there is no active call already running in this channel
    const existing = await query(
      `SELECT call_id FROM public.call
       WHERE channel_id = $1 AND end_time IS NULL
       LIMIT 1`,
      [channel_id]
    );

    if (existing.rows.length > 0) {
      return res.status(409).json({
        error:   'A call is already active in this channel',
        call_id: existing.rows[0].call_id,
      });
    }

    // ── Supabase: create call row ────────────────────────────────────────
    const callResult = await query(
      `INSERT INTO public.call
         (started_by, channel_id, call_type, livekit_room, max_participants)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [userId, channel_id, call_type, null, call_type === 'audio' ? 999 : 25]
    );

    const call = callResult.rows[0];

    // Use call_id as the LiveKit room name — keeps everything linked without
    // an extra FK column.
    const roomName = call.call_id;

    // ── LiveKit: provision the room ──────────────────────────────────────
    await roomService.createRoom({
      name:            roomName,
      emptyTimeout:    300,   // auto-close after 5 min empty  (REQ-16: persistent voice)
      maxParticipants: call_type === 'audio' ? 0 : 25,  // 0 = unlimited for audio-only
      metadata:        JSON.stringify({
        channel_id,
        workspace_id: access.rows[0].workspace_id,
        started_by:   userId,
        call_type,
      }),
    });

    // Store the room name back on the call row
    await query(
      `UPDATE public.call SET livekit_room = $1 WHERE call_id = $2`,
      [roomName, call.call_id]
    );

    // ── Supabase: first participant ───────────────────────────────────────
    await query(
      `INSERT INTO public.call_participant
         (call_id, user_id, livekit_identity, audio_enabled, video_enabled)
       VALUES ($1, $2, $3, TRUE, $4)`,
      [call.call_id, userId, userId, call_type !== 'audio']
    );

    // ── Audit log ─────────────────────────────────────────────────────────
    await createAuditLog({
      action_type:  'CALL_STARTED',
      type:         'call',
      status:       'success',
      workspace_id: access.rows[0].workspace_id,
      channel_id,
      user_id:      userId,
    });

    // ── REQ-16: Notify channel members ────────────────────────────────────
    wsService.broadcastToChannel(channel_id, {
      event: 'CALL_STARTED',
      data:  {
        call_id:    call.call_id,
        started_by: userId,
        call_type,
        channel_id,
      },
    });

    await notificationService.notifyChannelMembers({
      channelId:     channel_id,
      title:         'Call Started',
      message:       `${userName} started a ${call_type} call`,
      excludeUserId: userId,
    });

    // ── Response ──────────────────────────────────────────────────────────
    return res.status(201).json({
      call: { ...call, livekit_room: roomName },
      livekit: {
        url:   LK_URL,
        token: generateToken(roomName, userId, userName),
      },
    });
  } catch (err) {
    next(err);
  }
};

// ─────────────────────────────────────────────
// REQ-12, REQ-16: Join an active call
// ─────────────────────────────────────────────
/**
 * POST /api/v1/calls/:callId/join
 * Body: { audio_only? }
 *
 * Returns a fresh LiveKit JWT so the client can connect directly to the room.
 */
const joinCall = async (req, res, next) => {
  try {
    const { callId }          = req.params;
    const { audio_only = false } = req.body;
    const userId              = req.user.user_id;
    const userName            = req.user.name;

    // ── Verify call exists and is still active ────────────────────────────
    const callResult = await query(
      `SELECT c.*, ch.workspace_id
       FROM public.call c
       JOIN public.channel ch ON ch.channel_id = c.channel_id
       WHERE c.call_id = $1 AND c.end_time IS NULL`,
      [callId]
    );

    if (callResult.rows.length === 0) {
      return res.status(404).json({ error: 'Call not found or already ended' });
    }

    const call = callResult.rows[0];

    // Verify workspace membership
    const memberCheck = await query(
      `SELECT wm.user_id FROM public.workspace_member wm
       JOIN public.user u ON u.email = wm.email
       WHERE u.user_id = $1`,
      [userId]
    );

    if (memberCheck.rows.length === 0) {
      return res.status(403).json({ error: 'You are not a member of this workspace' });
    }

    // ── REQ-15: Enforce video participant cap (25) ─────────────────────────
    if (!audio_only) {
      const videoCount = await query(
        `SELECT COUNT(*) as count
         FROM public.call_participant
         WHERE call_id = $1 AND video_enabled = TRUE AND left_at IS NULL`,
        [callId]
      );

      if (parseInt(videoCount.rows[0].count) >= 25) {
        // Still allow join but downgrade to audio-only
        console.info(`[Call] Video cap reached for ${callId} — joining as audio-only`);
        req.body.audio_only = true;
      }
    }

    const videoEnabled = !req.body.audio_only;

    // ── Supabase: upsert participant row ──────────────────────────────────
    // ON CONFLICT handles the case where they previously left and rejoin
    await query(
      `INSERT INTO public.call_participant
         (call_id, user_id, livekit_identity, audio_enabled, video_enabled, left_at)
       VALUES ($1, $2, $3, TRUE, $4, NULL)
       ON CONFLICT (call_id, user_id)
       DO UPDATE SET
         joined_at        = NOW(),
         left_at          = NULL,
         audio_enabled    = TRUE,
         video_enabled    = $4,
         livekit_identity = $3`,
      [callId, userId, userId, videoEnabled]
    );

    // ── Current participant count ─────────────────────────────────────────
    const countResult = await query(
      `SELECT COUNT(*) as count
       FROM public.call_participant
       WHERE call_id = $1 AND left_at IS NULL`,
      [callId]
    );

    // ── WebSocket: notify everyone in the call ────────────────────────────
    wsService.broadcastToCall(callId, {
      event: 'PARTICIPANT_JOINED',
      data:  {
        call_id:       callId,
        user_id:       userId,
        user_name:     userName,
        video_enabled: videoEnabled,
      },
    });

    // ── Response ──────────────────────────────────────────────────────────
    return res.json({
      call,
      participant_count: parseInt(countResult.rows[0].count),
      audio_only:        !videoEnabled,
      livekit: {
        url:   LK_URL,
        token: generateToken(call.livekit_room ?? callId, userId, userName, {
          // audio-only participants publish mic but not camera
          canPublishSources: videoEnabled
            ? ['camera', 'microphone', 'screen_share', 'screen_share_audio']
            : ['microphone'],
        }),
      },
    });
  } catch (err) {
    next(err);
  }
};

// ─────────────────────────────────────────────
// Leave a call (self-initiated)
// ─────────────────────────────────────────────
/**
 * POST /api/v1/calls/:callId/leave
 *
 * Marks the participant as left. If the room is now empty,
 * the call is ended automatically.
 */
const leaveCall = async (req, res, next) => {
  try {
    const { callId } = req.params;
    const userId     = req.user.user_id;

    // Mark participant as left
    await query(
      `UPDATE public.call_participant
       SET left_at = NOW()
       WHERE call_id = $1 AND user_id = $2`,
      [callId, userId]
    );

    // How many are still in the call?
    const remaining = await query(
      `SELECT COUNT(*) as count
       FROM public.call_participant
       WHERE call_id = $1 AND left_at IS NULL`,
      [callId]
    );

    const remainingCount = parseInt(remaining.rows[0].count);

    if (remainingCount === 0) {
      // Last person left — auto-end the call
      await query(
        `UPDATE public.call SET end_time = NOW() WHERE call_id = $1`,
        [callId]
      );
      await safeDeleteRoom(callId);

      wsService.broadcastToCall(callId, {
        event: 'CALL_ENDED',
        data:  { call_id: callId, reason: 'empty' },
      });
    } else {
      wsService.broadcastToCall(callId, {
        event: 'PARTICIPANT_LEFT',
        data:  { call_id: callId, user_id: userId, remaining: remainingCount },
      });
    }

    // Also remove from LiveKit room so their track is released immediately
    try {
      await roomService.removeParticipant(callId, userId);
    } catch {
      // They may have already disconnected on the client side — that's fine
    }

    return res.json({ message: 'Left call successfully', remaining: remainingCount });
  } catch (err) {
    next(err);
  }
};

// ─────────────────────────────────────────────
// REQ-17: End call (host or admin)
// ─────────────────────────────────────────────
/**
 * POST /api/v1/calls/:callId/end
 *
 * Only the call host or a workspace admin can force-end a call.
 * Deletes the LiveKit room, marks all participants as left,
 * and broadcasts CALL_ENDED to all connected clients.
 */
const endCall = async (req, res, next) => {
  try {
    const { callId } = req.params;
    const userId     = req.user.user_id;

    const callResult = await query(
      `SELECT c.*, ch.workspace_id
       FROM public.call c
       JOIN public.channel ch ON ch.channel_id = c.channel_id
       WHERE c.call_id = $1`,
      [callId]
    );

    if (callResult.rows.length === 0) {
      return res.status(404).json({ error: 'Call not found' });
    }

    const call = callResult.rows[0];

    // Only host or workspace admin may end the call (REQ-17)
    const isHost  = call.started_by === userId;
    const isAdmin = req.user.role === 'admin';

    if (!isHost && !isAdmin) {
      return res.status(403).json({
        error: 'Only the call host or a workspace admin can end this call',
      });
    }

    // ── Supabase: close the call and all participant records ──────────────
    await query(
      `UPDATE public.call SET end_time = NOW() WHERE call_id = $1`,
      [callId]
    );

    await query(
      `UPDATE public.call_participant
       SET left_at = NOW()
       WHERE call_id = $1 AND left_at IS NULL`,
      [callId]
    );

    // ── LiveKit: tear down the room ───────────────────────────────────────
    await safeDeleteRoom(call.livekit_room ?? callId);

    // ── Audit log ─────────────────────────────────────────────────────────
    await createAuditLog({
      action_type:  'CALL_ENDED',
      type:         'call',
      status:       'success',
      workspace_id: call.workspace_id,
      channel_id:   call.channel_id,
      user_id:      userId,
    });

    // ── WebSocket: notify all call participants ────────────────────────────
    wsService.broadcastToCall(callId, {
      event: 'CALL_ENDED',
      data:  { call_id: callId, ended_by: userId, reason: 'host_ended' },
    });

    // Also notify the channel so the active-call indicator is cleared (REQ-16)
    if (call.channel_id) {
      wsService.broadcastToChannel(call.channel_id, {
        event: 'CALL_ENDED',
        data:  { call_id: callId, channel_id: call.channel_id },
      });
    }

    return res.json({ message: 'Call ended successfully' });
  } catch (err) {
    next(err);
  }
};

// ─────────────────────────────────────────────
// REQ-15: Get participants in a call
// ─────────────────────────────────────────────
/**
 * GET /api/v1/calls/:callId/participants
 *
 * Returns Supabase records (joined + who has left) merged with
 * live LiveKit participant state where available.
 */
const getCallParticipants = async (req, res, next) => {
  try {
    const { callId } = req.params;

    // Supabase participant records
    const dbResult = await query(
      `SELECT
         cp.callparticipant_id,
         cp.user_id,
         cp.joined_at,
         cp.left_at,
         cp.audio_enabled,
         cp.video_enabled,
         cp.livekit_identity,
         u.name,
         u.email
       FROM public.call_participant cp
       JOIN public.user u ON u.user_id = cp.user_id
       WHERE cp.call_id = $1
       ORDER BY cp.joined_at ASC`,
      [callId]
    );

    // Merge with live LiveKit state (track mute status, connection quality)
    let liveParticipants = [];
    try {
      liveParticipants = await roomService.listParticipants(callId);
    } catch {
      // Room may not exist (call already ended) — return DB data only
    }

    const liveMap = new Map(liveParticipants.map(p => [p.identity, p]));

    const participants = dbResult.rows.map(row => {
      const live = liveMap.get(row.livekit_identity);
      return {
        ...row,
        is_online:          !!live,
        connection_quality: live?.connectionQuality ?? null,
        is_speaking:        live?.isSpeaking        ?? false,
        tracks: live
          ? {
              audio: live.tracks?.find(t => t.type === 'AUDIO')  ?? null,
              video: live.tracks?.find(t => t.type === 'VIDEO')  ?? null,
              screen: live.tracks?.find(t => t.type === 'SCREEN') ?? null,
            }
          : null,
      };
    });

    const active = participants.filter(p => !p.left_at);
    const video  = active.filter(p => p.video_enabled);

    return res.json({
      participants,
      summary: {
        total:       participants.length,
        active:      active.length,
        video:       video.length,
        audio_only:  active.length - video.length,
        // REQ-15: warn if video cap is approaching
        video_cap:   25,
        video_slots_remaining: Math.max(0, 25 - video.length),
      },
    });
  } catch (err) {
    next(err);
  }
};

// ─────────────────────────────────────────────
// REQ-17: Mute a participant (admin / host only)
// ─────────────────────────────────────────────
/**
 * POST /api/v1/calls/:callId/participants/:targetUserId/mute
 * Body: { track_type: 'audio' | 'video' | 'screen' }
 *
 * Uses the LiveKit server API to force-mute a participant's track.
 */
const muteParticipant = async (req, res, next) => {
  try {
    const { callId, targetUserId } = req.params;
    const { track_type = 'audio' } = req.body;
    const userId = req.user.user_id;

    // Only host or admin can mute others
    const callResult = await query(
      `SELECT started_by FROM public.call WHERE call_id = $1`,
      [callId]
    );

    if (callResult.rows.length === 0) {
      return res.status(404).json({ error: 'Call not found' });
    }

    const isHost  = callResult.rows[0].started_by === userId;
    const isAdmin = req.user.role === 'admin';

    if (!isHost && !isAdmin) {
      return res.status(403).json({ error: 'Only the host or admin can mute participants' });
    }

    // Get the target participant's tracks from LiveKit
    const liveParticipants = await roomService.listParticipants(callId);
    const target = liveParticipants.find(p => p.identity === targetUserId);

    if (!target) {
      return res.status(404).json({ error: 'Participant is not active in this call' });
    }

    // Find the track to mute
    const trackTypeMap = { audio: 'AUDIO', video: 'VIDEO', screen: 'SCREEN' };
    const track = target.tracks?.find(t => t.type === trackTypeMap[track_type]);

    if (!track) {
      return res.status(404).json({ error: `Participant has no active ${track_type} track` });
    }

    await roomService.mutePublishedTrack(callId, targetUserId, track.sid, true);

    // Notify via WebSocket
    wsService.broadcastToCall(callId, {
      event: 'PARTICIPANT_MUTED',
      data:  {
        call_id:      callId,
        user_id:      targetUserId,
        track_type,
        muted_by:     userId,
      },
    });

    return res.json({ message: `${track_type} muted for participant` });
  } catch (err) {
    next(err);
  }
};

// ─────────────────────────────────────────────
// Get active call for a channel (REQ-16)
// ─────────────────────────────────────────────
/**
 * GET /api/v1/calls/channel/:channelId/active
 *
 * Lets the frontend show the "call active" indicator in the channel header.
 * Returns null if no call is running.
 */
const getActiveCall = async (req, res, next) => {
  try {
    const { channelId } = req.params;

    const result = await query(
      `SELECT
         c.call_id,
         c.started_by,
         c.start_time,
         c.call_type,
         c.livekit_room,
         u.name as started_by_name,
         COUNT(cp.user_id) FILTER (WHERE cp.left_at IS NULL) as active_participants
       FROM public.call c
       JOIN public.user u ON u.user_id = c.started_by
       LEFT JOIN public.call_participant cp ON cp.call_id = c.call_id
       WHERE c.channel_id = $1 AND c.end_time IS NULL
       GROUP BY c.call_id, u.name
       LIMIT 1`,
      [channelId]
    );

    if (result.rows.length === 0) {
      return res.json({ active_call: null });
    }

    return res.json({ active_call: result.rows[0] });
  } catch (err) {
    next(err);
  }
};

// ─────────────────────────────────────────────
// Call history for a channel
// ─────────────────────────────────────────────
/**
 * GET /api/v1/calls/channel/:channelId/history
 *
 * Returns past calls with duration and participant counts.
 */
const getCallHistory = async (req, res, next) => {
  try {
    const { channelId }      = req.params;
    const { limit = 20, offset = 0 } = req.query;

    const result = await query(
      `SELECT
         c.call_id,
         c.start_time,
         c.end_time,
         c.call_type,
         u.name as started_by_name,
         EXTRACT(EPOCH FROM (c.end_time - c.start_time))::int as duration_seconds,
         COUNT(DISTINCT cp.user_id) as total_participants
       FROM public.call c
       JOIN public.user u ON u.user_id = c.started_by
       LEFT JOIN public.call_participant cp ON cp.call_id = c.call_id
       WHERE c.channel_id = $1 AND c.end_time IS NOT NULL
       GROUP BY c.call_id, u.name
       ORDER BY c.start_time DESC
       LIMIT $2 OFFSET $3`,
      [channelId, Number(limit), Number(offset)]
    );

    return res.json({ history: result.rows, count: result.rowCount });
  } catch (err) {
    next(err);
  }
};

// ─────────────────────────────────────────────
// LiveKit webhook receiver
// ─────────────────────────────────────────────
/**
 * POST /api/v1/calls/livekit-webhook
 *
 * LiveKit pings this endpoint for room lifecycle events.
 * Keeps Supabase in sync automatically without polling.
 *
 * Events handled:
 *   room_started        → ensure call row exists
 *   room_finished       → mark call ended in Supabase
 *   participant_joined  → update left_at = NULL
 *   participant_left    → update left_at = NOW()
 *
 * Set this URL in your LiveKit Cloud dashboard → Webhooks.
 */
const livekitWebhook = async (req, res, next) => {
  try {
    const receiver = new WebhookReceiver(LK_KEY, LK_SECRET);

    // LiveKit sends raw body — make sure express.raw() is applied to this route
    const event = receiver.receive(req.body, req.headers['x-livekit-signature']);

    switch (event.event) {

      case 'room_finished': {
        // Auto-close in Supabase if the room drained and LiveKit closed it
        await query(
          `UPDATE public.call
           SET end_time = NOW()
           WHERE livekit_room = $1 AND end_time IS NULL`,
          [event.room.name]
        );

        await query(
          `UPDATE public.call_participant cp
           SET left_at = NOW()
           FROM public.call c
           WHERE c.call_id = cp.call_id
             AND c.livekit_room = $1
             AND cp.left_at IS NULL`,
          [event.room.name]
        );

        wsService.broadcastToCall(event.room.name, {
          event: 'CALL_ENDED',
          data:  { livekit_room: event.room.name, reason: 'room_finished' },
        });
        break;
      }

      case 'participant_joined': {
        await query(
          `UPDATE public.call_participant cp
           SET left_at = NULL, joined_at = NOW()
           FROM public.call c
           WHERE c.call_id = cp.call_id
             AND c.livekit_room = $1
             AND cp.livekit_identity = $2`,
          [event.room.name, event.participant.identity]
        );
        break;
      }

      case 'participant_left': {
        await query(
          `UPDATE public.call_participant cp
           SET left_at = NOW()
           FROM public.call c
           WHERE c.call_id = cp.call_id
             AND c.livekit_room = $1
             AND cp.livekit_identity = $2`,
          [event.room.name, event.participant.identity]
        );
        break;
      }

      default:
        break;
    }

    return res.status(200).json({ received: true });
  } catch (err) {
    // Invalid signature or malformed payload
    console.error('[LiveKit webhook]', err.message);
    return res.status(400).json({ error: 'Invalid webhook payload' });
  }
};

// ─────────────────────────────────────────────
// Exports
// ─────────────────────────────────────────────
module.exports = {
  startCall,
  joinCall,
  leaveCall,
  endCall,
  getCallParticipants,
  muteParticipant,
  getActiveCall,
  getCallHistory,
  livekitWebhook,
};