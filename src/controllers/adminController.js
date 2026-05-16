const supabase = require('../config/supabase');

// GET /api/admin/users
const getAllUsers = async (req, res) => {
  try {
    const { limit = 50, offset = 0 } = req.query;

    const { data: users, error, count } = await supabase
      .from('user')
      .select('user_id, name, email, status, created_at', { count: 'exact' })
      .order('created_at', { ascending: false })
      .range(Number(offset), Number(offset) + Number(limit) - 1);

    if (error) return res.status(500).json({ error: error.message });

    return res.json({ total: count, users });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
};

// PATCH /api/admin/users/:userId/status
const updateUserStatus = async (req, res) => {
  try {
    const { userId } = req.params;
    const { status } = req.body;

    const validStatuses = ['active', 'suspended', 'banned'];
    if (!status || !validStatuses.includes(status)) {
      return res.status(400).json({ error: `Status must be one of: ${validStatuses.join(', ')}` });
    }

    const { data, error } = await supabase
      .from('user')
      .update({ status })
      .eq('user_id', userId)
      .select('user_id, name, email, status')
      .single();

    if (error) return res.status(500).json({ error: error.message });
    if (!data) return res.status(404).json({ error: 'User not found' });

    return res.json(data);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
};

// DELETE /api/admin/users/:userId
const deleteUser = async (req, res) => {
  try {
    const { userId } = req.params;
    const requester_id = req.user.user_id;

    if (userId === requester_id) {
      return res.status(400).json({ error: 'You cannot delete your own account as admin' });
    }

    const { error } = await supabase
      .from('user')
      .delete()
      .eq('user_id', userId);

    if (error) return res.status(500).json({ error: error.message });

    return res.json({ message: 'User deleted successfully' });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
};

// GET /api/admin/workspaces
const getAllWorkspaces = async (req, res) => {
  try {
    const { limit = 50, offset = 0 } = req.query;

    const { data: workspaces, error, count } = await supabase
      .from('workspace')
      .select('workspace_id, name, description, is_public, created_at, user_id', { count: 'exact' })
      .order('created_at', { ascending: false })
      .range(Number(offset), Number(offset) + Number(limit) - 1);

    if (error) return res.status(500).json({ error: error.message });

    return res.json({ total: count, workspaces });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
};

// DELETE /api/admin/workspaces/:workspaceId
const deleteWorkspace = async (req, res) => {
  try {
    const { workspaceId } = req.params;

    const { error } = await supabase
      .from('workspace')
      .delete()
      .eq('workspace_id', workspaceId);

    if (error) return res.status(500).json({ error: error.message });

    return res.json({ message: 'Workspace deleted successfully' });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
};

// GET /api/admin/stats
const getStats = async (req, res) => {
  try {
    const [
      { count: totalUsers },
      { count: totalWorkspaces },
      { count: totalMessages },
      { count: totalChannels },
      { count: totalFiles },
    ] = await Promise.all([
      supabase.from('user').select('*', { count: 'exact', head: true }),
      supabase.from('workspace').select('*', { count: 'exact', head: true }),
      supabase.from('message').select('*', { count: 'exact', head: true }),
      supabase.from('channel').select('*', { count: 'exact', head: true }),
      supabase.from('file').select('*', { count: 'exact', head: true }),
    ]);

    return res.json({
      total_users: totalUsers,
      total_workspaces: totalWorkspaces,
      total_messages: totalMessages,
      total_channels: totalChannels,
      total_files: totalFiles,
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
};

// GET /api/admin/audit-logs
const getAuditLogs = async (req, res) => {
  try {
    const { limit = 50, offset = 0, workspace_id } = req.query;

    let query = supabase
      .from('auditlog')
      .select('*', { count: 'exact' })
      .order('auditlog_id', { ascending: false })
      .range(Number(offset), Number(offset) + Number(limit) - 1);

    if (workspace_id) {
      query = query.eq('workspace_id', workspace_id);
    }

    const { data, error, count } = await query;

    if (error) return res.status(500).json({ error: error.message });

    return res.json({ total: count, logs: data });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
};

module.exports = {
  getAllUsers,
  updateUserStatus,
  deleteUser,
  getAllWorkspaces,
  deleteWorkspace,
  getStats,
  getAuditLogs,
};