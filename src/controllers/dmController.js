const { supabase } = require('../config/supabase');

// GET /api/messages/conversations
const getConversations = async (req, res) => {
  try {
    const user_id = req.user.user_id;

    const { data, error } = await supabase
      .from('direct_message')
      .select('dm_id, content, created_at, sender_id, receiver_id, read')
      .or(`sender_id.eq.${user_id},receiver_id.eq.${user_id}`)
      .order('created_at', { ascending: false });

    if (error) return res.status(500).json({ error: error.message });

    const seen       = new Map();
    const partnerIds = [];

    for (const msg of data) {
      const partnerId = msg.sender_id === user_id ? msg.receiver_id : msg.sender_id;
      if (!seen.has(partnerId)) {
        seen.set(partnerId, {
          user_id:         partnerId,
          last_message:    msg.content,
          last_message_at: msg.created_at,
          unread_count:    0,
        });
        partnerIds.push(partnerId);
      }
      if (msg.receiver_id === user_id && !msg.read) {
        seen.get(partnerId).unread_count++;
      }
    }

    if (!partnerIds.length) return res.json([]);

    const { data: users, error: userError } = await supabase
      .from('user')
      .select('user_id, name, email, avatar_url, status')
      .in('user_id', partnerIds);

    if (userError) return res.status(500).json({ error: userError.message });

    const userMap = Object.fromEntries(users.map(u => [u.user_id, u]));

    const conversations = partnerIds.map(id => ({
      ...userMap[id],
      ...seen.get(id),
    }));

    return res.json(conversations);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
};

// GET /api/messages/dm/:userId
const getDmMessages = async (req, res) => {
  try {
    const user_id  = req.user.user_id;
    const other_id = req.params.userId;
    const { limit = 50 } = req.query;

    const { data, error } = await supabase
      .from('direct_message')
      .select('dm_id, content, created_at, sender_id, receiver_id, read')
      .or(
        `and(sender_id.eq.${user_id},receiver_id.eq.${other_id}),and(sender_id.eq.${other_id},receiver_id.eq.${user_id})`
      )
      .order('created_at', { ascending: true })
      .limit(Number(limit));

    if (error) return res.status(500).json({ error: error.message });

    // Mark received messages as read
    await supabase
      .from('direct_message')
      .update({ read: true })
      .eq('receiver_id', user_id)
      .eq('sender_id', other_id)
      .eq('read', false);

    return res.json(data);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
};

// POST /api/messages/dm
const sendDm = async (req, res) => {
  try {
    const sender_id                = req.user.user_id;
    const { receiver_id, content } = req.body;

    if (!receiver_id || !content) {
      return res.status(400).json({ error: 'receiver_id and content are required' });
    }

    if (sender_id === receiver_id) {
      return res.status(400).json({ error: 'Cannot send a DM to yourself' });
    }

    const { data: receiver } = await supabase
      .from('user')
      .select('user_id')
      .eq('user_id', receiver_id)
      .single();

    if (!receiver) return res.status(404).json({ error: 'User not found' });

    const { data: dm, error } = await supabase
      .from('direct_message')
      .insert({
        sender_id,
        receiver_id,
        content,
        read:       false,
        created_at: new Date().toISOString(),
      })
      .select()
      .single();

    if (error) return res.status(500).json({ error: error.message });

    const io = req.app.get('io');
    if (io) {
      io.to(`user:${receiver_id}`).emit('new_dm', dm);
      io.to(`user:${sender_id}`).emit('new_dm', dm);
    }

    return res.status(201).json(dm);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
};

module.exports = { getConversations, getDmMessages, sendDm };