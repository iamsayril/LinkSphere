const { supabaseAdmin } = require('../config/supabase');

// POST /api/messages OR POST /api/channels/:channelId/messages
const sendMessage = async (req, res) => {
  try {
    const channel_id = req.body.channel_id || req.params.channelId;
    const { content, parent_message_id } = req.body;
    const user_id = req.user.user_id;

    if (!channel_id || !content) {
      return res.status(400).json({ error: 'channel_id and content are required' });
    }

    const { data: members } = await supabaseAdmin
  .from('channel_member')
  .select('channel_member_id')
  .eq('channel_id', channel_id)
  .eq('user_id', user_id);

if (!members || members.length === 0) {
  return res.status(403).json({ error: 'You are not a member of this channel' });
}

const { data: channelData } = await supabaseAdmin
.from('channel')
.select('name')
.eq('channel_id', channel_id)
.single();

const { data: message, error } = await supabaseAdmin
.from('message')
.insert({
  channel_id,
  content,
  user_id,
  parent_message_id: parent_message_id || null,
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
})
      .select(`
        message_id,
        content,
        created_at,
        updated_at,
        parent_message_id,
        channel_id,
        user:user_id (user_id, name, email),
        files:file (file_id, file_name, file_url, file_type, size)
      `)
      .single();
    // ↑ Only change from your original: added files:file(...) so the socket
    //   emit carries the same shape as getMessages. Files will be [] on insert
    //   since they are uploaded right after using the returned message_id.

    if (error) return res.status(500).json({ error: error.message });

    const io = req.app.get('io');
    if (io) {
      io.to(channel_id).emit('new_message', message);

      // Notify all channel members in their user rooms (for notification page)
      const { data: channelMembers } = await supabaseAdmin
        .from('channel_member')
        .select('user_id')
        .eq('channel_id', channel_id);

      if (channelMembers) {
        channelMembers
          .filter(m => m.user_id !== user_id)
          .forEach(m => {
            io.to(`user:${m.user_id}`).emit('new_channel_message', {
              channel_id,
              channel_name: channelData?.name || 'a channel',
              sender_name:  message.user?.name || 'Someone',
              content:      message.content,
              created_at:   message.created_at,
            });
          });
      }
    }

    return res.status(201).json(message);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
};

// GET /api/messages/:channelId OR GET /api/channels/:channelId/messages
const getMessages = async (req, res) => {
  try {
    const channelId = req.params.channelId;
    const { limit = 50, before } = req.query;
    const user_id = req.user.user_id;

    const { data: members } = await supabaseAdmin
  .from('channel_member')
  .select('channel_member_id')
  .eq('channel_id', channelId)
  .eq('user_id', user_id);

if (!members || members.length === 0) {
  return res.status(403).json({ error: 'You are not a member of this channel' });
}

    let query = supabaseAdmin
      .from('message')
      .select(`
        message_id,
        content,
        created_at,
        updated_at,
        parent_message_id,
        channel_id,
        user:user_id (user_id, name, email),
        reactions:reaction (reaction_id, emoji, user_id),
        files:file (file_id, file_name, file_url, file_type, size)
      `)
      .eq('channel_id', channelId)
      .is('parent_message_id', null)
      .order('created_at', { ascending: false })
      .limit(Number(limit));

    if (before) query = query.lt('created_at', before);

    const { data: messages, error } = await query;

    if (error) return res.status(500).json({ error: error.message });

    return res.json(messages.reverse());
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
};

// GET /api/messages/:messageId/thread
const getThread = async (req, res) => {
  try {
    const { messageId } = req.params;
    const user_id = req.user.user_id;

    const { data: parent } = await supabaseAdmin
      .from('message')
      .select('channel_id')
      .eq('message_id', messageId)
      .single();

    if (!parent) return res.status(404).json({ error: 'Message not found' });

    const { data: members } = await supabaseAdmin
  .from('channel_member')
  .select('channel_member_id')
  .eq('channel_id', parent.channel_id)
  .eq('user_id', user_id);

if (!members || members.length === 0) return res.status(403).json({ error: 'Access denied' });

    const { data: replies, error } = await supabaseAdmin
      .from('message')
      .select(`
        message_id,
        content,
        created_at,
        updated_at,
        parent_message_id,
        user:user_id (user_id, name, email),
        reactions:reaction (reaction_id, emoji, user_id)
      `)
      .eq('parent_message_id', messageId)
      .order('created_at', { ascending: true });

    if (error) return res.status(500).json({ error: error.message });

    return res.json(replies);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
};

// PATCH /api/messages/:messageId
const editMessage = async (req, res) => {
  try {
    const { messageId } = req.params;
    const { content } = req.body;
    const user_id = req.user.user_id;

    if (!content) return res.status(400).json({ error: 'content is required' });

    const { data: existing } = await supabaseAdmin
      .from('message')
      .select('user_id, channel_id')
      .eq('message_id', messageId)
      .single();

    if (!existing) return res.status(404).json({ error: 'Message not found' });
    if (existing.user_id !== user_id) return res.status(403).json({ error: 'You can only edit your own messages' });

    const { data: message, error } = await supabaseAdmin
      .from('message')
      .update({ content, updated_at: new Date().toISOString() })
      .eq('message_id', messageId)
      .select(`
        message_id,
        content,
        created_at,
        updated_at,
        channel_id,
        user:user_id (user_id, name, email)
      `)
      .single();

    if (error) return res.status(500).json({ error: error.message });

    const io = req.app.get('io');
    if (io) io.to(existing.channel_id).emit('message_edited', message);

    return res.json(message);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
};

// DELETE /api/messages/:messageId
const deleteMessage = async (req, res) => {
  try {
    const { messageId } = req.params;
    const user_id = req.user.user_id;

    const { data: existing } = await supabaseAdmin
      .from('message')
      .select('user_id, channel_id')
      .eq('message_id', messageId)
      .single();

    if (!existing) return res.status(404).json({ error: 'Message not found' });
    if (existing.user_id !== user_id) return res.status(403).json({ error: 'You can only delete your own messages' });

    const { error } = await supabaseAdmin
      .from('message')
      .delete()
      .eq('message_id', messageId);

    if (error) return res.status(500).json({ error: error.message });

    const io = req.app.get('io');
    if (io) io.to(existing.channel_id).emit('message_deleted', { message_id: messageId, channel_id: existing.channel_id });

    return res.json({ message: 'Message deleted successfully' });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
};

// POST /api/messages/:messageId/reactions
const addReaction = async (req, res) => {
  try {
    const { messageId } = req.params;
    const { emoji } = req.body;
    const user_id = req.user.user_id;

    if (!emoji) return res.status(400).json({ error: 'emoji is required' });

    const { data: message } = await supabaseAdmin
      .from('message')
      .select('channel_id')
      .eq('message_id', messageId)
      .single();

    if (!message) return res.status(404).json({ error: 'Message not found' });

    // Remove any existing reaction by this user on this message first
    await supabaseAdmin
      .from('reaction')
      .delete()
      .eq('message_id', messageId)
      .eq('user_id', user_id);

    // Delete any existing reaction by this user on this message (enforces 1 reaction per user)
    await supabaseAdmin
      .from('reaction')
      .delete()
      .eq('message_id', messageId)
      .eq('user_id', user_id);

    const { data: reaction, error } = await supabaseAdmin
      .from('reaction')
      .insert({
        message_id: messageId,
        user_id,
        emoji,
        channel_id: message.channel_id,
      })
      .select()
      .single();

    if (error) return res.status(500).json({ error: error.message });

    if (error) return res.status(500).json({ error: error.message });

    // Fetch channel name, reactor name and message owner for notification
    const { data: channelData } = await supabaseAdmin
      .from('channel')
      .select('name')
      .eq('channel_id', message.channel_id)
      .single();

    const { data: reactor } = await supabaseAdmin
      .from('user')
      .select('name')
      .eq('user_id', user_id)
      .single();

    const { data: originalMessage } = await supabaseAdmin
      .from('message')
      .select('user_id')
      .eq('message_id', messageId)
      .single();

      const io = req.app.get('io');
      if (io) {
        const payload = {
          message_id:       messageId,
          reaction,
          reactor_id:       user_id,
          reactor_name:     reactor?.name || 'Someone',
          message_owner_id: originalMessage?.user_id || null,
          emoji:            emoji,
          channel_name:     channelData?.name || 'channel',
        };
  
        // Emit to channel room (for live reaction updates in workspace)
        io.to(message.channel_id).emit('reaction_added', payload);
  
        // Also emit directly to message owner's user room (for notification page)
        if (originalMessage?.user_id && originalMessage.user_id !== user_id) {
          io.to(`user:${originalMessage.user_id}`).emit('reaction_added', payload);
        }
      }

    return res.status(201).json(reaction);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
};

// DELETE /api/messages/:messageId/reactions/:emoji
const removeReaction = async (req, res) => {
  try {
    const { messageId, emoji } = req.params;
    const user_id = req.user.user_id;

    const { data: message } = await supabaseAdmin
      .from('message')
      .select('channel_id')
      .eq('message_id', messageId)
      .single();

    const { error } = await supabaseAdmin
      .from('reaction')
      .delete()
      .eq('message_id', messageId)
      .eq('user_id', user_id)
      .eq('emoji', emoji);

    if (error) return res.status(500).json({ error: error.message });

    const io = req.app.get('io');
    if (io) io.to(message.channel_id).emit('reaction_removed', { message_id: messageId, emoji, user_id });

    return res.json({ message: 'Reaction removed' });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
};

module.exports = {
  sendMessage,
  getMessages,
  getThread,
  editMessage,
  deleteMessage,
  addReaction,
  removeReaction,
};