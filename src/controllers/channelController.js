const supabase = require('../config/supabase');

// POST /api/channels
const createChannel = async (req, res) => {
  try {
    const { name, description, is_private, workspace_id } = req.body;
    const user_id = req.user.user_id;

    if (!name || !workspace_id) {
      return res.status(400).json({ error: 'name and workspace_id are required' });
    }

    // Create channel
    const { data: channel, error } = await supabase
      .from('channel')
      .insert({
        name,
        workspace_id,
        created_at: new Date().toISOString(),
      })
      .select()
      .single();

    if (error) return res.status(500).json({ error: error.message });

    // Auto-add creator as admin
    await supabase
      .from('channel_member')
      .insert({
        channel_id: channel.channel_id,
        user_id,
        role: 'admin',
        joined_at: new Date().toISOString(),
      });

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

    // Get channels where user is a member
    const { data: channels, error } = await supabase
      .from('channel')
      .select(`
        channel_id,
        name,
        created_at,
        workspace_id,
        channel_member!inner (
          role,
          joined_at,
          user_id
        )
      `)
      .eq('workspace_id', workspace_id)
      .eq('channel_member.user_id', user_id);

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

    // Check membership
    const { data: member } = await supabase
      .from('channel_member')
      .select('role')
      .eq('channel_id', channelId)
      .eq('user_id', user_id)
      .single();

    if (!member) return res.status(403).json({ error: 'You are not a member of this channel' });

    const { data: channel, error } = await supabase
      .from('channel')
      .select(`
        channel_id,
        name,
        created_at,
        workspace_id,
        channel_member (
          user_id,
          role,
          joined_at,
          user:user_id (user_id, name, email)
        )
      `)
      .eq('channel_id', channelId)
      .single();

    if (error) return res.status(500).json({ error: error.message });

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

    // Check if already a member
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
      .insert({
        channel_id: channelId,
        user_id,
        role: 'member',
        joined_at: new Date().toISOString(),
      })
      .select()
      .single();

    if (error) return res.status(500).json({ error: error.message });

    // Notify channel members
    const io = req.app.get('io');
    if (io) {
      io.to(channelId).emit('member_joined', { channel_id: channelId, user_id });
    }

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
    if (io) {
      io.to(channelId).emit('member_left', { channel_id: channelId, user_id });
    }

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

    // Check if user is admin
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

    // Check if user is admin
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