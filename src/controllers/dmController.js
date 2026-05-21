const { supabaseAdmin } = require('../config/supabase');
const multer = require('multer');
const https  = require('https');
const http   = require('http');

// ─── Multer (in-memory storage) ───────────────────────────────────────────────

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10 MB max
});

// ─── GET /api/dm/conversations ────────────────────────────────────────────────

const getConversations = async (req, res) => {
  try {
    const user_id = req.user.user_id;

    const { data, error } = await supabaseAdmin
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

    const { data: users, error: userError } = await supabaseAdmin
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

    const { data, error } = await supabaseAdmin
      .from('direct_message')
      .select(`dm_id, content, created_at, sender_id, receiver_id, read, file_url, file_name, file_type, file_size, dm_reaction(dm_reaction_id, emoji, user_id)`)
      .or(
        `and(sender_id.eq.${user_id},receiver_id.eq.${other_id}),and(sender_id.eq.${other_id},receiver_id.eq.${user_id})`
      )
      .order('created_at', { ascending: true })
      .limit(Number(limit));

    if (error) return res.status(500).json({ error: error.message });

    // Mark received messages as read
    await supabaseAdmin
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

    const { data: receiver } = await supabaseAdmin
      .from('user')
      .select('user_id')
      .eq('user_id', receiver_id)
      .single();

    if (!receiver) return res.status(404).json({ error: 'User not found' });

    const { data: dm, error } = await supabaseAdmin
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

    const { data: sender } = await supabaseAdmin
      .from('user')
      .select('name')
      .eq('user_id', sender_id)
      .single();

    const io = req.app.get('io');
    if (io) {
      io.to(`user:${receiver_id}`).emit('new_dm', {
        ...dm,
        sender_name: sender?.name || 'Someone',
      });
      io.to(`user:${sender_id}`).emit('new_dm', {
        ...dm,
        sender_name: sender?.name || 'Someone',
      });
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
      const content     = req.body.content || '';

      if (!receiver_id) {
        return res.status(400).json({ error: 'receiver_id is required' });
      }

      if (sender_id === receiver_id) {
        return res.status(400).json({ error: 'Cannot send a DM to yourself' });
      }

      if (!req.file) {
        return res.status(400).json({ error: 'No file provided' });
      }

      const { data: receiver } = await supabaseAdmin
        .from('user')
        .select('user_id')
        .eq('user_id', receiver_id)
        .single();

      if (!receiver) return res.status(404).json({ error: 'User not found' });

      // ── Upload file to Supabase Storage ──────────────────────────────────
      const ext       = req.file.originalname.split('.').pop();
      const fileName  = `dm/${sender_id}/${Date.now()}.${ext}`;

      const { error: uploadError } = await supabaseAdmin.storage
        .from('linksphere-files')
        .upload(fileName, req.file.buffer, {
          contentType: req.file.mimetype,
          upsert:      false,
        });

      if (uploadError) {
        return res.status(500).json({ error: `Storage upload failed: ${uploadError.message}` });
      }

      // ── Get public URL ────────────────────────────────────────────────────
      const { data: urlData } = supabaseAdmin.storage
        .from('linksphere-files')
        .getPublicUrl(fileName);

      const file_url = urlData.publicUrl;

      // ── Save message to DB ────────────────────────────────────────────────
      const { data: dm, error: dbError } = await supabaseAdmin
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

// ─── GET /api/dm/proxy-video ──────────────────────────────────────────────────
// Proxies Supabase Storage video URLs with proper Range header forwarding,
// which is required for browsers to stream video continuously (206 responses).

const proxyVideo = (req, res) => {
  const { url } = req.query;

  if (!url) {
    return res.status(400).json({ error: 'Missing url param' });
  }

  // Validate URL and restrict to your Supabase storage domain only
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return res.status(400).json({ error: 'Invalid URL' });
  }

  const allowedHost = process.env.SUPABASE_URL
    ? new URL(process.env.SUPABASE_URL).hostname
    : null;

  if (allowedHost && parsed.hostname !== allowedHost) {
    return res.status(403).json({ error: 'Forbidden: URL not from allowed storage host' });
  }

  // Forward Range header from browser so Supabase returns 206 Partial Content
  const upstreamHeaders = {};
  if (req.headers['range']) {
    upstreamHeaders['Range'] = req.headers['range'];
  }

  const client = parsed.protocol === 'https:' ? https : http;

  const upstream = client.request(url, { headers: upstreamHeaders }, (upstreamRes) => {
    // Pass through only the headers the browser needs for streaming
    const passthroughHeaders = [
      'content-type',
      'content-length',
      'content-range',
      'accept-ranges',
      'last-modified',
      'etag',
      'cache-control',
    ];

    res.status(upstreamRes.statusCode);

    passthroughHeaders.forEach(h => {
      if (upstreamRes.headers[h]) res.setHeader(h, upstreamRes.headers[h]);
    });

    // Always declare range support so browser knows it can stream
    res.setHeader('Accept-Ranges', 'bytes');

    upstreamRes.pipe(res);
  });

  upstream.on('error', (err) => {
    console.error('[proxyVideo] Upstream error:', err.message);
    if (!res.headersSent) res.status(502).json({ error: 'Proxy upstream failed' });
  });

  upstream.end();
};

// POST /api/dm/:dmId/reactions
const addDmReaction = async (req, res) => {
  try {
    const { dmId } = req.params;
    const { emoji } = req.body;
    const user_id = req.user.user_id;

    if (!emoji) return res.status(400).json({ error: 'emoji is required' });

    const { data: dm } = await supabaseAdmin
      .from('direct_message')
      .select('dm_id, sender_id, receiver_id')
      .eq('dm_id', dmId)
      .single();

    if (!dm) return res.status(404).json({ error: 'Message not found' });

    // Only participants of the DM can react
    if (dm.sender_id !== user_id && dm.receiver_id !== user_id) {
      return res.status(403).json({ error: 'Access denied' });
    }

    // Remove any existing reaction by this user on this message first
    await supabaseAdmin
      .from('dm_reaction')
      .delete()
      .eq('dm_id', dmId)
      .eq('user_id', user_id);

    const { data: reaction, error } = await supabaseAdmin
      .from('dm_reaction')
      .insert(
        { dm_id: dmId, user_id, emoji }
      )
      .select()
      .single();

    if (error) return res.status(500).json({ error: error.message });

    const { data: reactor } = await supabaseAdmin
      .from('user')
      .select('name')
      .eq('user_id', user_id)
      .single();

    const io = req.app.get('io');
    if (io) {
      const roomA = `user:${dm.sender_id}`;
      const roomB = `user:${dm.receiver_id}`;
      io.to(roomA).to(roomB).emit('dm_reaction_added', {
        dm_id:        dmId,
        reaction,
        reactor_id:   user_id,
        reactor_name: reactor?.name || 'Someone',
        emoji:        emoji,
      });
    }

    return res.status(201).json(reaction);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
};

// DELETE /api/dm/:dmId/reactions/:emoji
const removeDmReaction = async (req, res) => {
  try {
    const { dmId, emoji } = req.params;
    const user_id = req.user.user_id;

    const { data: dm } = await supabaseAdmin
      .from('direct_message')
      .select('dm_id, sender_id, receiver_id')
      .eq('dm_id', dmId)
      .single();

    if (!dm) return res.status(404).json({ error: 'Message not found' });

    if (dm.sender_id !== user_id && dm.receiver_id !== user_id) {
      return res.status(403).json({ error: 'Access denied' });
    }

    const { error } = await supabaseAdmin
      .from('dm_reaction')
      .delete()
      .eq('dm_id', dmId)
      .eq('user_id', user_id)
      .eq('emoji', decodeURIComponent(emoji));

    if (error) return res.status(500).json({ error: error.message });

    const io = req.app.get('io');
    if (io) {
      io.to(`user:${dm.sender_id}`).to(`user:${dm.receiver_id}`)
        .emit('dm_reaction_removed', { dm_id: dmId, emoji, user_id });
    }

    return res.json({ message: 'Reaction removed' });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
};


module.exports = { 
  getConversations, getDmMessages, sendDm, uploadDmFile, proxyVideo,
  addDmReaction, removeDmReaction  // add these
};