const { supabaseAdmin } = require('../config/supabase');

// POST /api/channels
const createChannel = async (req, res) => {
  try {
    const { name, workspace_id, is_private, type } = req.body;
    const user_id = req.user.user_id;

    if (!name || !workspace_id) {
      return res.status(400).json({ error: 'name and workspace_id are required' });
    }

    // Verify user is a workspace member
    const { data: wsMember } = await supabaseAdmin
      .from('workspace_member')
      .select('role')
      .eq('workspace_id', workspace_id)
      .eq('user_id', user_id)
      .single();

    if (!wsMember) {
      return res.status(403).json({ error: 'You are not a member of this workspace' });
    }

    // Create channel
    // is_private is extracted below with the insert

    const { data: channel, error } = await supabaseAdmin
      .from('channel')
      .insert({ name, workspace_id, type: type || 'text', is_private: is_private === true, created_at: new Date().toISOString() })
      .select()
      .single();

    if (error) return res.status(500).json({ error: error.message });

    // ✅ Add ALL current workspace members to the new channel
    const { data: wsMembers, error: membersError } = await supabaseAdmin
      .from('workspace_member')
      .select('user_id')
      .eq('workspace_id', workspace_id);

    if (membersError) {
      await supabaseAdmin.from('channel').delete().eq('channel_id', channel.channel_id);
      return res.status(500).json({ error: 'Failed to fetch workspace members' });
    }

    // For private channels, only add the creator. For public, add all members.
    const membersToAdd = is_private
      ? wsMembers.filter(m => m.user_id === user_id)
      : wsMembers;

    const channelMembers = membersToAdd.map(m => ({
      channel_id: channel.channel_id,
      user_id:    m.user_id,
      role:       m.user_id === user_id ? 'admin' : 'member',
      joined_at:  new Date().toISOString(),
    }));

    const { error: memberError } = await supabaseAdmin
  .from('channel_member')
  .upsert(channelMembers, { onConflict: 'channel_id,user_id' });

if (memberError) {
  await supabaseAdmin.from('channel').delete().eq('channel_id', channel.channel_id);
  return res.status(500).json({ error: 'Failed to add members: ' + memberError.message });
}

    return res.status(201).json(channel);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
};

// GET /api/channels
const getChannels = async (req, res) => {
  try {
    const user_id = req.user.user_id;
    const { workspace_id } = req.query;

    if (!workspace_id) {
      return res.status(400).json({ error: 'workspace_id is required' });
    }

    // ✅ Verify user is a workspace member (not channel member)
    const { data: wsMember } = await supabaseAdmin
      .from('workspace_member')
      .select('role')
      .eq('workspace_id', workspace_id)
      .eq('user_id', user_id)
      .single();

    if (!wsMember) {
      return res.status(403).json({ error: 'You are not a member of this workspace' });
    }

    // Get workspace to check if user is owner
    const { data: workspace } = await supabaseAdmin
      .from('workspace')
      .select('user_id')
      .eq('workspace_id', workspace_id)
      .single();

    const isOwner = workspace?.user_id === user_id;

    // Fetch all channels
    const { data: channels, error } = await supabaseAdmin
      .from('channel')
      .select('channel_id, name, created_at, workspace_id, is_private, type')
      .eq('workspace_id', workspace_id)
      .order('created_at', { ascending: true });

      if (error) return res.status(500).json({ error: error.message });

      // Ensure type field is always present
      const normalizedChannels = channels.map(ch => ({
        ...ch,
        type: ch.type || (ch.name?.startsWith('voice_') || ch.name?.toLowerCase() === 'lobby' ? 'voice' : 'text'),
      }));

    if (isOwner) {
      // Owner sees all channels
      return res.json(normalizedChannels);
    }

    // For non-owners: filter out private channels they are not a member of
    const privateChannelIds = normalizedChannels
      .filter(ch => ch.is_private)
      .map(ch => ch.channel_id);

      if (!privateChannelIds.length) {
        return res.json(normalizedChannels);
      }

    const { data: memberships } = await supabaseAdmin
      .from('channel_member')
      .select('channel_id')
      .eq('user_id', user_id)
      .in('channel_id', privateChannelIds);

    const allowedPrivateIds = new Set((memberships || []).map(m => m.channel_id));

    const visibleChannels = normalizedChannels.filter(ch =>
      !ch.is_private || allowedPrivateIds.has(ch.channel_id)
    );

    return res.json(visibleChannels);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
};

// GET /api/channels/:channelId
const getChannel = async (req, res) => {
  try {
    const { channelId } = req.params;
    const user_id = req.user.user_id;

    // ✅ Check workspace membership instead of channel membership
    const { data: channel, error: chError } = await supabaseAdmin
      .from('channel')
      .select('channel_id, name, created_at, workspace_id')
      .eq('channel_id', channelId)
      .single();

    if (chError || !channel) return res.status(404).json({ error: 'Channel not found' });

    const { data: wsMember } = await supabaseAdmin
      .from('workspace_member')
      .select('role')
      .eq('workspace_id', channel.workspace_id)
      .eq('user_id', user_id)
      .single();

    if (!wsMember) return res.status(403).json({ error: 'You are not a member of this workspace' });

    return res.json(channel);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
};

// POST /api/channels/:channelId/join
const joinChannel = async (req, res) => {
  try {
    const { channelId } = req.params;
    const user_id = req.user.user_id;

    const { data: existing } = await supabaseAdmin
      .from('channel_member')
      .select('channel_member_id')
      .eq('channel_id', channelId)
      .eq('user_id', user_id)
      .single();

    if (existing) {
      return res.status(409).json({ error: 'You are already a member of this channel' });
    }

    const { data, error } = await supabaseAdmin
      .from('channel_member')
      .insert({ channel_id: channelId, user_id, role: 'member', joined_at: new Date().toISOString() })
      .select()
      .single();

    if (error) return res.status(500).json({ error: error.message });

    const io = req.app.get('io');
    if (io) io.to(channelId).emit('member_joined', { channel_id: channelId, user_id });

    return res.status(201).json({ message: 'Joined channel successfully', data });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
};

// DELETE /api/channels/:channelId/leave
const leaveChannel = async (req, res) => {
  try {
    const { channelId } = req.params;
    const user_id = req.user.user_id;

    const { error } = await supabaseAdmin
      .from('channel_member')
      .delete()
      .eq('channel_id', channelId)
      .eq('user_id', user_id);

    if (error) return res.status(500).json({ error: error.message });

    const io = req.app.get('io');
    if (io) io.to(channelId).emit('member_left', { channel_id: channelId, user_id });

    return res.json({ message: 'Left channel successfully' });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
};

// PATCH /api/channels/:channelId
const updateChannel = async (req, res) => {
  try {
    const { channelId } = req.params;
    const { name } = req.body;
    const user_id = req.user.user_id;

    if (!name) return res.status(400).json({ error: 'name is required' });

    // Get channel to find workspace_id
    const { data: channel } = await supabaseAdmin
      .from('channel')
      .select('workspace_id')
      .eq('channel_id', channelId)
      .single();

    if (!channel) return res.status(404).json({ error: 'Channel not found' });

    // Check workspace role
    const { data: wsMember } = await supabaseAdmin
      .from('workspace_member')
      .select('role')
      .eq('workspace_id', channel.workspace_id)
      .eq('user_id', user_id)
      .single();

    if (!wsMember || !['owner', 'admin'].includes(wsMember.role)) {
      return res.status(403).json({ error: 'Only workspace owners and admins can rename channels' });
    }

    const { data: updated, error } = await supabaseAdmin
      .from('channel')
      .update({ name })
      .eq('channel_id', channelId)
      .select()
      .single();

    if (error) return res.status(500).json({ error: error.message });

    return res.json(updated);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
};

// PATCH /api/channels/:channelId
const deleteChannel = async (req, res) => {
  try {
    const { channelId } = req.params;
    const user_id = req.user.user_id;

    // Get channel to find workspace_id
    const { data: channel } = await supabaseAdmin
      .from('channel')
      .select('workspace_id')
      .eq('channel_id', channelId)
      .single();

    if (!channel) return res.status(404).json({ error: 'Channel not found' });

    // Check workspace role — only owner can delete
    const { data: wsMember } = await supabaseAdmin
      .from('workspace_member')
      .select('role')
      .eq('workspace_id', channel.workspace_id)
      .eq('user_id', user_id)
      .single();

    if (!wsMember || wsMember.role !== 'owner') {
      return res.status(403).json({ error: 'Only workspace owners can delete channels' });
    }

    const { error } = await supabaseAdmin
      .from('channel')
      .delete()
      .eq('channel_id', channelId);

    if (error) return res.status(500).json({ error: error.message });

    return res.json({ message: 'Channel deleted successfully' });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
};

// GET /api/channels/:channelId/voice-members
const getVoiceMembers = async (req, res) => {
  try {
    const { channelId } = req.params;
    const io = req.app.get('io');
    if (!io) return res.json([]);

    const members = [];
    const sockets = await io.fetchSockets();
    for (const s of sockets) {
      if (s.voiceChannelId === channelId && s.voiceUser) {
        members.push(s.voiceUser);
      }
    }

    return res.json(members);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
};

// GET /api/channels/:channelId/access
const getChannelAccess = async (req, res) => {
  try {
    const { channelId } = req.params;
    const { data, error } = await supabaseAdmin
      .from('channel_member')
      .select('user_id, role')
      .eq('channel_id', channelId);
    if (error) return res.status(500).json({ error: error.message });
    return res.json(data || []);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
};

// POST /api/channels/:channelId/access
const addChannelAccess = async (req, res) => {
  try {
    const { channelId } = req.params;
    const { user_id } = req.body;
    if (!user_id) return res.status(400).json({ error: 'user_id is required' });
    const { error } = await supabaseAdmin
      .from('channel_member')
      .upsert({ channel_id: channelId, user_id, role: 'member', joined_at: new Date().toISOString() }, { onConflict: 'channel_id,user_id' });
    if (error) return res.status(500).json({ error: error.message });
    return res.status(201).json({ message: 'Access granted' });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
};

// DELETE /api/channels/:channelId/access/:userId
const removeChannelAccess = async (req, res) => {
  try {
    const { channelId, userId } = req.params;
    const { error } = await supabaseAdmin
      .from('channel_member')
      .delete()
      .eq('channel_id', channelId)
      .eq('user_id', userId);
    if (error) return res.status(500).json({ error: error.message });
    return res.json({ message: 'Access removed' });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
};

module.exports = {
  createChannel,
  getChannels,
  getChannel,
  joinChannel,
  leaveChannel,
  updateChannel,
  deleteChannel,
  getVoiceMembers,
  getChannelAccess,
  addChannelAccess,
  removeChannelAccess,
};