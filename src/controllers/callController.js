'use strict';

/**
 * callController.js
 * LinkSphere — Voice & Video Call Controller
 */

const { AccessToken, RoomServiceClient, WebhookReceiver } = require('livekit-server-sdk');
const { supabaseAdmin }            = require('../config/supabaseAdmin');
const notificationService     = require('../services/notificationService');
const { createAuditLog }      = require('../services/auditService');

// ─────────────────────────────────────────────
// LiveKit client
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
// Helper: get Socket.io instance from app
// ─────────────────────────────────────────────
// FIX: replaces the undefined `wsService` references throughout this file.
// req.app.get('io') returns the Socket.io server set in server.js via app.set('io', io).
function broadcastToChannel(app, channelId, payload) {
  const io = app?.get('io');
  if (io) io.to(`channel:${channelId}`).emit(payload.event, payload.data);
}

function broadcastToCall(app, callId, payload) {
  const io = app?.get('io');
  if (io) io.to(`call:${callId}`).emit(payload.event, payload.data);
}

// ─────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────
async function generateToken(roomName, userId, userName, overrides = {}) {
  const at = new AccessToken(LK_KEY, LK_SECRET, {
    identity: userId,
    name:     userName,
    ttl:      '4h',
  });

  at.addGrant({
    roomJoin:          true,
    room:              roomName,
    canPublish:        true,
    canPublishSources: ['camera', 'microphone'],
    canSubscribe:      true,
    canPublishData:    true,
    roomAdmin:         overrides.roomAdmin ?? false,
    ...overrides,
  });

  return await at.toJwt();
}

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
const startCall = async (req, res, next) => {
  try {
    const { channel_id, call_type = 'video' } = req.body;
    const userId   = req.user.user_id;
    const userName = req.user.name;

    if (!channel_id) {
      return res.status(400).json({ error: 'channel_id is required' });
    }

    // Verify the user is a workspace member for this channel
    const { data: channel, error: channelError } = await supabaseAdmin
      .from('channel')
      .select('channel_id, workspace_id')
      .eq('channel_id', channel_id)
      .single();

    if (channelError || !channel) {
      return res.status(404).json({ error: 'Channel not found' });
    }

    const { data: member, error: memberError } = await supabaseAdmin  
      .from('workspace_member')
      .select('user_id')
      .eq('workspace_id', channel.workspace_id)
      .eq('user_id', userId)
      .single();

    if (memberError || !member) {
      return res.status(403).json({ error: 'You are not a member of this workspace' });
    }

    const access = channel;

    // Check no active call is already running in this channel
    const { data: existing, error: existingError } = await supabaseAdmin
  .from('call')
  .select('call_id')
  .eq('channel_id', channel_id)
  .is('end_time', null)
  .limit(1)
  .maybeSingle();

    if (existing) {
      return res.status(409).json({
        error:   'A call is already active in this channel',
        call_id: existing.call_id,
      });
    }

    // Create call row
    const { data: call, error: callError } = await supabaseAdmin
      .from('call')
      .insert({
        started_by:       userId,
        channel_id,
        call_type,
        livekit_room:     null,
        start_time:       new Date().toISOString(),   // ← add this
        max_participants: call_type === 'audio' ? 999 : 25,
      })
      .select()
      .single();

    if (callError) throw callError;

    const roomName = call.call_id;

    // Create LiveKit room
    await roomService.createRoom({
      name:            roomName,
      emptyTimeout:    300,
      maxParticipants: call_type === 'audio' ? 0 : 25,
      metadata:        JSON.stringify({
        channel_id,
        workspace_id: access.workspace_id,
        started_by:   userId,
        call_type,
      }),
    });

    // Store room name on call row
    const { error: updateError } = await supabaseAdmin
      .from('call')
      .update({ livekit_room: roomName })
      .eq('call_id', call.call_id);

    if (updateError) throw updateError;

    // Add caller as first participant
    const { error: participantError } = await supabaseAdmin
  .from('call_participant')
  .insert({
    call_id:          call.call_id,
    user_id:          userId,
    livekit_identity: userId,
    audio_enabled:    true,
    video_enabled:    call_type !== 'audio',
    joined_at:        new Date().toISOString(),  // ← ADD THIS
  });

    if (participantError) throw participantError;

    // Audit log (non-fatal)
    try {
      await createAuditLog({
        action_type:  'CALL_STARTED',
        type:         'call',
        status:       'success',
        workspace_id: channel.workspace_id,
        channel_id,
        user_id:      userId,
      });
    } catch (auditErr) {
      console.warn('[startCall] Audit log failed (non-fatal):', auditErr.message);
    }

    // FIX: was wsService.broadcastToChannel(...) — now uses req.app
    broadcastToChannel(req.app, channel_id, {
      event: 'CALL_STARTED',
      data:  { call_id: call.call_id, started_by: userId, call_type, channel_id },
    });

    try {
      await notificationService.notifyChannelMembers({
        channelId:     channel_id,
        title:         'Call Started',
        message:       `${userName} started a ${call_type} call`,
        excludeUserId: userId,
      });
    } catch (notifyErr) {
      console.warn('[startCall] Notification failed (non-fatal):', notifyErr.message);
    }

    return res.status(201).json({
      call: { ...call, livekit_room: roomName },
      livekit: {
        url:   LK_URL,
        token: await generateToken(roomName, userId, userName),
      },
    });
  } catch (err) {
    next(err);
  }
};

// ─────────────────────────────────────────────
// REQ-12, REQ-16: Join an active call
// ─────────────────────────────────────────────
const joinCall = async (req, res, next) => {
  try {
    const { callId }             = req.params;
    const { audio_only = false } = req.body;
    const userId                 = req.user.user_id;
    const userName               = req.user.name;

    // Verify call exists and is active
    const { data: call, error: callError } = await supabaseAdmin
      .from('call')
      .select('*, channel(workspace_id)')
      .eq('call_id', callId)
      .is('end_time', null)
      .single();

    if (callError || !call) {
      return res.status(404).json({ error: 'Call not found or already ended' });
    }

    // Verify workspace membership
    // Verify workspace membership
    const { data: member } = await supabaseAdmin
      .from('workspace_member')
      .select('user_id')
      .eq('workspace_id', call.channel.workspace_id)
      .eq('user_id', userId)
      .single();

    if (!member) {
      return res.status(403).json({ error: 'You are not a member of this workspace' });
    }

    // REQ-15: enforce video cap
    let videoEnabled = !audio_only;
    if (videoEnabled) {
      const { count } = await supabaseAdmin
        .from('call_participant')
        .select('*', { count: 'exact', head: true })
        .eq('call_id', callId)
        .eq('video_enabled', true)
        .is('left_at', null);

      if (count >= 25) {
        console.info(`[Call] Video cap reached for ${callId} — joining as audio-only`);
        videoEnabled = false;
      }
    }

    // Upsert participant row
    const { error: upsertError } = await supabaseAdmin
      .from('call_participant')
      .upsert({
        call_id:          callId,
        user_id:          userId,
        livekit_identity: userId,
        audio_enabled:    true,
        video_enabled:    videoEnabled,
        left_at:          null,
        joined_at:        new Date().toISOString(),
      }, { onConflict: 'call_id,user_id' });

    if (upsertError) throw upsertError;

    // Current participant count
    const { count: participantCount } = await supabaseAdmin
      .from('call_participant')
      .select('*', { count: 'exact', head: true })
      .eq('call_id', callId)
      .is('left_at', null);

    // FIX: was wsService.broadcastToCall(...) — now uses req.app
    broadcastToCall(req.app, callId, {
      event: 'PARTICIPANT_JOINED',
      data:  { call_id: callId, user_id: userId, user_name: userName, video_enabled: videoEnabled },
    });

    return res.json({
      call,
      participant_count: participantCount,
      audio_only:        !videoEnabled,
      livekit: {
        url:   LK_URL,
        token: await generateToken(call.livekit_room ?? callId, userId, userName, {
          canPublishSources: videoEnabled
            ? ['camera', 'microphone']
            : ['microphone'],
        }),
      },
    });
  } catch (err) {
    next(err);
  }
};

// ─────────────────────────────────────────────
// Leave a call
// ─────────────────────────────────────────────
const leaveCall = async (req, res, next) => {
  try {
    const { callId } = req.params;
    const userId     = req.user.user_id;

    // Mark participant as left
    const { error } = await supabaseAdmin
      .from('call_participant')
      .update({ left_at: new Date().toISOString() })
      .eq('call_id', callId)
      .eq('user_id', userId);

    if (error) throw error;

    // Count remaining participants
    const { count: remainingCount } = await supabaseAdmin
      .from('call_participant')
      .select('*', { count: 'exact', head: true })
      .eq('call_id', callId)
      .is('left_at', null);

    if (remainingCount === 0) {
      // Last person — auto-end
      await supabaseAdmin
        .from('call')
        .update({ end_time: new Date().toISOString() })
        .eq('call_id', callId);

      await safeDeleteRoom(callId);

      // FIX: was wsService.broadcastToCall(...)
      broadcastToCall(req.app, callId, {
        event: 'CALL_ENDED',
        data:  { call_id: callId, reason: 'empty' },
      });
    } else {
      // FIX: was wsService.broadcastToCall(...)
      broadcastToCall(req.app, callId, {
        event: 'PARTICIPANT_LEFT',
        data:  { call_id: callId, user_id: userId, remaining: remainingCount },
      });
    }

    try {
      await roomService.removeParticipant(callId, userId);
    } catch {
      // Already disconnected client-side — fine
    }

    return res.json({ message: 'Left call successfully', remaining: remainingCount });
  } catch (err) {
    next(err);
  }
};

// ─────────────────────────────────────────────
// REQ-17: End call (host or admin)
// ─────────────────────────────────────────────
const endCall = async (req, res, next) => {
  try {
    const { callId } = req.params;
    const userId     = req.user.user_id;

    const { data: call, error: callError } = await supabaseAdmin
      .from('call')
      .select('*, channel(workspace_id)')
      .eq('call_id', callId)
      .single();

    if (callError || !call) {
      return res.status(404).json({ error: 'Call not found' });
    }

    const isHost  = call.started_by === userId;
    const isAdmin = req.user.role === 'admin';

    if (!isHost && !isAdmin) {
      return res.status(403).json({
        error: 'Only the call host or a workspace admin can end this call',
      });
    }

    // Close call
    await supabaseAdmin
      .from('call')
      .update({ end_time: new Date().toISOString() })
      .eq('call_id', callId);

    // Mark all participants as left
    await supabaseAdmin
      .from('call_participant')
      .update({ left_at: new Date().toISOString() })
      .eq('call_id', callId)
      .is('left_at', null);

    await safeDeleteRoom(call.livekit_room ?? callId);

    // Audit log
    try {
      await createAuditLog({
        action_type:  'CALL_ENDED',           // also fix the action type
        type:         'call',
        status:       'success',
        workspace_id: call.channel?.workspace_id ?? null,  // ✅ already fetched above
        channel_id:   call.channel_id ?? null,             // ✅ from the call row
        user_id:      userId,
      });
    } catch (auditErr) {
      console.warn('[startCall] Audit log failed (non-fatal):', auditErr.message);
    }

    // FIX: was wsService.broadcastToCall(...)
    broadcastToCall(req.app, callId, {
      event: 'CALL_ENDED',
      data:  { call_id: callId, ended_by: userId, reason: 'host_ended' },
    });

    if (call.channel_id) {
      // FIX: was wsService.broadcastToChannel(...)
      broadcastToChannel(req.app, call.channel_id, {
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
// REQ-15: Get participants
// ─────────────────────────────────────────────
const getCallParticipants = async (req, res, next) => {
  try {
    const { callId } = req.params;

    const { data: dbParticipants, error } = await supabaseAdmin
      .from('call_participant')
      .select('callparticipant_id, user_id, joined_at, left_at, audio_enabled, video_enabled, livekit_identity, user(name, email)')
      .eq('call_id', callId)
      .order('joined_at', { ascending: true });

    if (error) throw error;

    let liveParticipants = [];
    try {
      liveParticipants = await roomService.listParticipants(callId);
    } catch {
      // Room may already be gone
    }

    const liveMap = new Map(liveParticipants.map(p => [p.identity, p]));

    const participants = dbParticipants.map(row => {
      const live = liveMap.get(row.livekit_identity);
      return {
        ...row,
        name:               row.user?.name,
        email:              row.user?.email,
        is_online:          !!live,
        connection_quality: live?.connectionQuality ?? null,
        is_speaking:        live?.isSpeaking        ?? false,
        tracks: live ? {
          audio:  live.tracks?.find(t => t.type === 'AUDIO')  ?? null,
          video:  live.tracks?.find(t => t.type === 'VIDEO')  ?? null,
          screen: live.tracks?.find(t => t.type === 'SCREEN') ?? null,
        } : null,
      };
    });

    const active = participants.filter(p => !p.left_at);
    const video  = active.filter(p => p.video_enabled);

    return res.json({
      participants,
      summary: {
        total:                 participants.length,
        active:                active.length,
        video:                 video.length,
        audio_only:            active.length - video.length,
        video_cap:             25,
        video_slots_remaining: Math.max(0, 25 - video.length),
      },
    });
  } catch (err) {
    next(err);
  }
};

// ─────────────────────────────────────────────
// REQ-17: Mute a participant
// ─────────────────────────────────────────────
const muteParticipant = async (req, res, next) => {
  try {
    const { callId, targetUserId } = req.params;
    const { track_type = 'audio' } = req.body;
    const userId = req.user.user_id;

    const { data: call, error: callError } = await supabaseAdmin
      .from('call')
      .select('started_by')
      .eq('call_id', callId)
      .single();

    if (callError || !call) {
      return res.status(404).json({ error: 'Call not found' });
    }

    const isHost  = call.started_by === userId;
    const isAdmin = req.user.role === 'admin';

    if (!isHost && !isAdmin) {
      return res.status(403).json({ error: 'Only the host or admin can mute participants' });
    }

    const liveParticipants = await roomService.listParticipants(callId);
    const target = liveParticipants.find(p => p.identity === targetUserId);

    if (!target) {
      return res.status(404).json({ error: 'Participant is not active in this call' });
    }

    const trackTypeMap = { audio: 'AUDIO', video: 'VIDEO', screen: 'SCREEN' };
    const track = target.tracks?.find(t => t.type === trackTypeMap[track_type]);

    if (!track) {
      return res.status(404).json({ error: `Participant has no active ${track_type} track` });
    }

    await roomService.mutePublishedTrack(callId, targetUserId, track.sid, true);

    // FIX: was wsService.broadcastToCall(...)
    broadcastToCall(req.app, callId, {
      event: 'PARTICIPANT_MUTED',
      data:  { call_id: callId, user_id: targetUserId, track_type, muted_by: userId },
    });

    return res.json({ message: `${track_type} muted for participant` });
  } catch (err) {
    next(err);
  }
};

// ─────────────────────────────────────────────
// REQ-16: Get active call for a channel
// ─────────────────────────────────────────────
const getActiveCall = async (req, res, next) => {
  try {
    const { channelId } = req.params;

    const { data: call, error } = await supabaseAdmin
      .from('call')
      .select('call_id, started_by, start_time, call_type, livekit_room, user(name), call_participant(user_id, left_at)')
      .eq('channel_id', channelId)
      .is('end_time', null)
      .single();

    if (error || !call) {
      return res.json({ active_call: null });
    }

    const activeParticipants = call.call_participant?.filter(p => !p.left_at).length ?? 0;

    return res.json({
      active_call: {
        ...call,
        started_by_name:    call.user?.name,
        active_participants: activeParticipants,
      },
    });
  } catch (err) {
    next(err);
  }
};

// ─────────────────────────────────────────────
// Call history for a channel
// ─────────────────────────────────────────────
const getCallHistory = async (req, res, next) => {
  try {
    const { channelId }              = req.params;
    const { limit = 20, offset = 0 } = req.query;

    const { data: history, error } = await supabaseAdmin
      .from('call')
      .select('call_id, start_time, end_time, call_type, user(name), call_participant(user_id)')
      .eq('channel_id', channelId)
      .not('end_time', 'is', null)
      .order('start_time', { ascending: false })
      .range(Number(offset), Number(offset) + Number(limit) - 1);

    if (error) throw error;

    const formatted = history.map(c => ({
      call_id:            c.call_id,
      start_time:         c.start_time,
      end_time:           c.end_time,
      call_type:          c.call_type,
      started_by_name:    c.user?.name,
      total_participants: c.call_participant?.length ?? 0,
      duration_seconds:   c.end_time
        ? Math.floor((new Date(c.end_time) - new Date(c.start_time)) / 1000)
        : null,
    }));

    return res.json({ history: formatted, count: formatted.length });
  } catch (err) {
    next(err);
  }
};

// ─────────────────────────────────────────────
// LiveKit webhook
// ─────────────────────────────────────────────
const livekitWebhook = async (req, res, next) => {
  try {
    const receiver = new WebhookReceiver(LK_KEY, LK_SECRET);
    const event    = receiver.receive(req.body, req.headers['x-livekit-signature']);

    switch (event.event) {

      case 'room_finished': {
        await supabaseAdmin
          .from('call')
          .update({ end_time: new Date().toISOString() })
          .eq('livekit_room', event.room.name)
          .is('end_time', null);

        const { data: calls } = await supabaseAdmin
          .from('call')
          .select('call_id')
          .eq('livekit_room', event.room.name);

        if (calls?.length) {
          await supabaseAdmin
            .from('call_participant')
            .update({ left_at: new Date().toISOString() })
            .eq('call_id', calls[0].call_id)
            .is('left_at', null);
        }

        // FIX: was wsService.broadcastToCall(...)
        // Note: no req.app here (webhook context), use the io instance directly
        // This is handled via the app instance stored on global or passed differently.
        // For now we log — the LiveKit room_finished event is a fallback safety net.
        console.log(`[LiveKit webhook] room_finished: ${event.room.name}`);
        break;
      }

      case 'participant_joined': {
        const { data: calls } = await supabaseAdmin
          .from('call')
          .select('call_id')
          .eq('livekit_room', event.room.name);

        if (calls?.length) {
          await supabaseAdmin
            .from('call_participant')
            .update({ left_at: null, joined_at: new Date().toISOString() })
            .eq('call_id', calls[0].call_id)
            .eq('livekit_identity', event.participant.identity);
        }
        break;
      }

      case 'participant_left': {
        const { data: calls } = await supabaseAdmin
          .from('call')
          .select('call_id')
          .eq('livekit_room', event.room.name);

        if (calls?.length) {
          await supabaseAdmin
            .from('call_participant')
            .update({ left_at: new Date().toISOString() })
            .eq('call_id', calls[0].call_id)
            .eq('livekit_identity', event.participant.identity);
        }
        break;
      }

      default:
        break;
    }

    return res.status(200).json({ received: true });
  } catch (err) {
    console.error('[LiveKit webhook]', err.message);
    return res.status(400).json({ error: 'Invalid webhook payload' });
  }
};

// ─────────────────────────────────────────────
// Exports
// ─────────────────────────────────────────────
// ─────────────────────────────────────────────
// DM Call: Start
// ─────────────────────────────────────────────
const startDmCall = async (req, res, next) => {
  try {
    const { receiver_id, room_name, call_type = 'audio' } = req.body;
    const caller_id = req.user.user_id;

    if (!receiver_id || !room_name) {
      return res.status(400).json({ error: 'receiver_id and room_name are required' });
    }

    const { data: dmCall, error } = await supabaseAdmin
      .from('dm_call')
      .insert({
        caller_id,
        receiver_id,
        room_name,
        call_type,
      })
      .select()
      .single();

    if (error) throw error;

    return res.status(201).json({ dm_call: dmCall });
  } catch (err) {
    next(err);
  }
};

// ─────────────────────────────────────────────
// DM Call: End
// ─────────────────────────────────────────────
const endDmCall = async (req, res, next) => {
  try {
    const { dmCallId } = req.params;
    const userId = req.user.user_id;

    const { data: dmCall, error: fetchError } = await supabaseAdmin
      .from('dm_call')
      .select('*')
      .eq('dm_call_id', dmCallId)
      .single();

    if (fetchError || !dmCall) {
      return res.status(404).json({ error: 'DM call not found' });
    }

    if (dmCall.caller_id !== userId && dmCall.receiver_id !== userId) {
      return res.status(403).json({ error: 'Not authorized to end this call' });
    }

    const { error: updateError } = await supabaseAdmin
      .from('dm_call')
      .update({ end_time: new Date().toISOString() })
      .eq('dm_call_id', dmCallId);

    if (updateError) throw updateError;

    return res.json({ message: 'DM call ended successfully' });
  } catch (err) {
    next(err);
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
  startDmCall,
  endDmCall,
};