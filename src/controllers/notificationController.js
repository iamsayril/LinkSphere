const supabaseAdmin = require('../config/supabase');

// GET /api/notifications
const getNotifications = async (req, res) => {
  try {
    console.log('req.user:', req.user);
    const user_id = req.user.user_id;
    console.log('user_id:', user_id);
    const { limit = 20, unread_only } = req.query;

    let query = supabaseAdmin
      .from('notification')
      .select('*')
      .eq('user_id', user_id)
      .order('created_at', { ascending: false })
      .limit(Number(limit));

    if (unread_only === 'true') {
      query = query.is('read_at', null);
    }

    const { data, error } = await query;

    if (error) {
      console.log('Supabase error:', JSON.stringify(error));
      return res.status(500).json({ error: error.message });
    }

    return res.json(data);
  } catch (err) {
    console.log('CATCH ERROR:', err);
    return res.status(500).json({ error: err.message });
  }
};

// PATCH /api/notifications/:notificationId/read
const markAsRead = async (req, res) => {
  try {
    const { notificationId } = req.params;
    const user_id = req.user.user_id;

    const { data, error } = await supabaseAdmin
      .from('notification')
      .update({ read_at: new Date().toISOString(), status: 'read' })
      .eq('notification_id', notificationId)
      .eq('user_id', user_id)
      .select()
      .single();

    if (error) return res.status(500).json({ error: error.message });
    if (!data) return res.status(404).json({ error: 'Notification not found' });

    return res.json(data);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
};

// PATCH /api/notifications/read-all
const markAllAsRead = async (req, res) => {
  try {
    const user_id = req.user.user_id;

    const { error } = await supabaseAdmin
      .from('notification')
      .update({ read_at: new Date().toISOString(), status: 'read' })
      .eq('user_id', user_id)
      .is('read_at', null);

    if (error) return res.status(500).json({ error: error.message });

    return res.json({ message: 'All notifications marked as read' });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
};

// DELETE /api/notifications/:notificationId
const deleteNotification = async (req, res) => {
  try {
    const { notificationId } = req.params;
    const user_id = req.user.user_id;

    const { error } = await supabaseAdmin
      .from('notification')
      .delete()
      .eq('notification_id', notificationId)
      .eq('user_id', user_id);

    if (error) return res.status(500).json({ error: error.message });

    return res.json({ message: 'Notification deleted successfully' });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
};

// DELETE /api/notifications
const deleteAllNotifications = async (req, res) => {
  try {
    const user_id = req.user.user_id;

    const { error } = await supabaseAdmin
      .from('notification')
      .delete()
      .eq('user_id', user_id);

    if (error) return res.status(500).json({ error: error.message });

    return res.json({ message: 'All notifications deleted successfully' });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
};

// POST /api/notifications (internal use - send notification to a user)
const createNotification = async (req, res) => {
  try {
    const { user_id, title, message, type } = req.body;

    if (!user_id || !title) {
      return res.status(400).json({ error: 'user_id and title are required' });
    }

    const { data, error } = await supabaseAdmin
      .from('notification')
      .insert({
        user_id,
        title,
        message,
        type,
        status: 'unread',
        created_at: new Date().toISOString(),
      })
      .select()
      .single();

    if (error) return res.status(500).json({ error: error.message });

    // Emit real-time notification
    const io = req.app.get('io');
    if (io) {
      io.to(`user:${user_id}`).emit('new_notification', data);
    }

    return res.status(201).json(data);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
};

// GET /api/notifications/unread-count
const getUnreadCount = async (req, res) => {
  try {
    const user_id = req.user.user_id;

    const { count, error } = await supabaseAdmin
      .from('notification')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', user_id)
      .is('read_at', null);

    if (error) return res.status(500).json({ error: error.message });

    return res.json({ unread_count: count });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
};

module.exports = {
  getNotifications,
  markAsRead,
  markAllAsRead,
  deleteNotification,
  deleteAllNotifications,
  createNotification,
  getUnreadCount,
};