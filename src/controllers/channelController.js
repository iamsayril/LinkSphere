const { supabase } = require('../config/supabase');

// POST /api/channels
const createChannel = async (req, res) => {
  try {
    const { name, workspace_id } = req.body;
    const user_id = req.user.user_id;

    if (!name || !workspace_id) {
      return res.status(400).json({ error: 'name and workspace_id are required' });
    }

    // Verify user is a workspace member
    const { data: wsMember } = await supabase
      .from('workspace_member')
      .select('role')
      .eq('workspace_id', workspace_id)
      .eq('user_id', user_id)
      .single();

    if (!wsMember) {
      return res.status(403).json({ error: 'You are not a member of this workspace' });
    }

    // Create channel
    const { data: channel, error } = await supabase
      .from('channel')
      .insert({ name, workspace_id, created_at: new Date().toISOString() })
      .select()
      .single();

    if (error) return res.status(500).json({ error: error.message });

    // ✅ Add ALL current workspace members to the new channel
    const { data: wsMembers, error: membersError } = await supabase
      .from('workspace_member')
      .select('user_id')
      .eq('workspace_id', workspace_id);

    if (membersError) {
      await supabase.from('channel').delete().eq('channel_id', channel.channel_id);
      return res.status(500).json({ error: 'Failed to fetch workspace members' });
    }

    const channelMembers = wsMembers.map(m => ({
      channel_id: channel.channel_id,
      user_id:    m.user_id,
      role:       m.user_id === user_id ? 'admin' : 'member',
      joined_at:  new Date().toISOString(),
    }));

    const { error: memberError } = await supabase
      .from('channel_member')
      .insert(channelMembers);

    if (memberError) {
      await supabase.from('channel').delete().eq('channel_id', channel.channel_id);
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
    const { data: wsMember } = await supabase
      .from('workspace_member')
      .select('role')
      .eq('workspace_id', workspace_id)
      .eq('user_id', user_id)
      .single();

    if (!wsMember) {
      return res.status(403).json({ error: 'You are not a member of this workspace' });
    }

    // ✅ Return ALL channels in the workspace — no channel_member filter
    const { data: channels, error } = await supabase
      .from('channel')
      .select('channel_id, name, created_at, workspace_id')
      .eq('workspace_id', workspace_id)
      .order('created_at', { ascending: true });

    if (error) return res.status(500).json({ error: error.message });

    return res.json(channels);
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
    const { data: channel, error: chError } = await supabase
      .from('channel')
      .select('channel_id, name, created_at, workspace_id')
      .eq('channel_id', channelId)
      .single();

    if (chError || !channel) return res.status(404).json({ error: 'Channel not found' });

    const { data: wsMember } = await supabase
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

    const { data: existing } = await supabase
      .from('channel_member')
      .select('channel_member_id')
      .eq('channel_id', channelId)
      .eq('user_id', user_id)
      .single();

    if (existing) {
      return res.status(409).json({ error: 'You are already a member of this channel' });
    }

    const { data, error } = await supabase
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

    const { error } = await supabase
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

    const { data: member } = await supabase
      .from('channel_member')
      .select('role')
      .eq('channel_id', channelId)
      .eq('user_id', user_id)
      .single();

    if (!member || member.role !== 'admin') {
      return res.status(403).json({ error: 'Only channel admins can update the channel' });
    }

    const { data: channel, error } = await supabase
      .from('channel')
      .update({ name })
      .eq('channel_id', channelId)
      .select()
      .single();

    if (error) return res.status(500).json({ error: error.message });

    return res.json(channel);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
};

// DELETE /api/channels/:channelId
const deleteChannel = async (req, res) => {
  try {
    const { channelId } = req.params;
    const user_id = req.user.user_id;

    const { data: member } = await supabase
      .from('channel_member')
      .select('role')
      .eq('channel_id', channelId)
      .eq('user_id', user_id)
      .single();

    if (!member || member.role !== 'admin') {
      return res.status(403).json({ error: 'Only channel admins can delete the channel' });
    }

    const { error } = await supabase
      .from('channel')
      .delete()
      .eq('channel_id', channelId);

    if (error) return res.status(500).json({ error: error.message });

    return res.json({ message: 'Channel deleted successfully' });
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
};