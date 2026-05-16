const supabase = require('../config/supabase');

const requireAdmin = async (req, res, next) => {
  try {
    const user_id = req.user.user_id;
    const { workspaceId } = req.params;

    if (!workspaceId) {
      // Global admin check — check if user is owner of any workspace
      const { data } = await supabase
        .from('workspace')
        .select('workspace_id')
        .eq('user_id', user_id)
        .limit(1);

      if (!data || data.length === 0) {
        return res.status(403).json({ error: 'Admin access required' });
      }

      return next();
    }

    // Workspace-level admin check
    const { data: member } = await supabase
      .from('workspace_member')
      .select('role')
      .eq('workspace_id', workspaceId)
      .eq('user_id', user_id)
      .single();

    if (!member || !['owner', 'admin'].includes(member.role)) {
      return res.status(403).json({ error: 'Admin access required' });
    }

    next();
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
};

module.exports = { requireAdmin };