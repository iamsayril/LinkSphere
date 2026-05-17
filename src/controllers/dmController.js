const { supabase } = require('../config/supabase');
const multer = require('multer');

// ─── Multer (in-memory storage) ───────────────────────────────────────────────

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10 MB max
});

// ─── GET /api/dm/conversations ────────────────────────────────────────────────

const getConversations = async (req, res) => {
  try {
    const user_id = req.user.user_id;

    const { data, error } = await supabase
      .from('direct_message')
      .select('dm_id, content, created_at, sender_id, receiver_id, read, file_url, file_name')
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
          last_message:    msg.content || (msg.file_name ? `📎 ${msg.file_name}` : 'File'),
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

// ─── GET /api/dm/:userId ──────────────────────────────────────────────────────

const getDmMessages = async (req, res) => {
  try {
    const user_id  = req.user.user_id;
    const other_id = req.params.userId;
    const { limit = 50 } = req.query;

    const { data, error } = await supabase
      .from('direct_message')
      .select('dm_id, content, created_at, sender_id, receiver_id, read, file_url, file_name, file_type, file_size')
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

// ─── POST /api/dm ─────────────────────────────────────────────────────────────

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

// ─── POST /api/dm/upload ──────────────────────────────────────────────────────

const uploadDmFile = [
  upload.single('file'),
  async (req, res) => {
    try {
      const sender_id   = req.user.user_id;
      const receiver_id = req.body.receiver_id;
      const content     = req.body.content || null;

      if (!receiver_id) {
        return res.status(400).json({ error: 'receiver_id is required' });
      }

      if (sender_id === receiver_id) {
        return res.status(400).json({ error: 'Cannot send a DM to yourself' });
      }

      if (!req.file) {
        return res.status(400).json({ error: 'No file provided' });
      }

      const { data: receiver } = await supabase
        .from('user')
        .select('user_id')
        .eq('user_id', receiver_id)
        .single();

      if (!receiver) return res.status(404).json({ error: 'User not found' });

      // ── Upload file to Supabase Storage ──────────────────────────────────
      const ext       = req.file.originalname.split('.').pop();
      const fileName  = `dm/${sender_id}/${Date.now()}.${ext}`;

      const { error: uploadError } = await supabase.storage
        .from('linksphere-files')
        .upload(fileName, req.file.buffer, {
          contentType: req.file.mimetype,
          upsert:      false,
        });

      if (uploadError) {
        return res.status(500).json({ error: `Storage upload failed: ${uploadError.message}` });
      }

      // ── Get public URL ────────────────────────────────────────────────────
      const { data: urlData } = supabase.storage
        .from('linksphere-files')
        .getPublicUrl(fileName);

      const file_url = urlData.publicUrl;

      // ── Save message to DB ────────────────────────────────────────────────
      const { data: dm, error: dbError } = await supabase
        .from('direct_message')
        .insert({
          sender_id,
          receiver_id,
          content,
          file_url,
          file_name: req.file.originalname,
          file_type: req.file.mimetype,
          file_size: req.file.size,
          read:       false,
          created_at: new Date().toISOString(),
        })
        .select()
        .single();

      if (dbError) return res.status(500).json({ error: dbError.message });

      // ── Emit via socket ───────────────────────────────────────────────────
      const io = req.app.get('io');
      if (io) {
        io.to(`user:${receiver_id}`).emit('new_dm', dm);
        io.to(`user:${sender_id}`).emit('new_dm', dm);
      }

      return res.status(201).json(dm);
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }
];

module.exports = { getConversations, getDmMessages, sendDm, uploadDmFile };