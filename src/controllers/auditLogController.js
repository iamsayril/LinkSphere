const { supabaseAdmin } = require('../config/supabase');

// ─── Helper: Create Audit Log Entry ──────────────────────────────────────────

const createAuditLog = async ({ action_type, type, workspace_id, channel_id = null, user_id = null, actor_name = null, description = null }) => {
  try {
    const { error: auditError } = await supabaseAdmin
      .from('auditlog')
      .insert({
        action_type,
        type,
        workspace_id,
        channel_id,
        user_id,
        actor_name,
        description,
        status: 'success',
        created_at: new Date().toISOString(),
      });
    if (auditError) console.error('Audit insert failed:', auditError.message);
  } catch (err) {
    console.error('Audit log error:', err.message);
  }
};

// ─── GET /api/audit-logs/:workspaceId ────────────────────────────────────────

const getAuditLogs = async (req, res) => {
  try {
    const { workspaceId } = req.params;
    const user_id = req.user.user_id;

    // Only owner can view audit logs
    const { data: workspace } = await supabaseAdmin
      .from('workspace')
      .select('user_id')
      .eq('workspace_id', workspaceId)
      .single();

    if (!workspace) return res.status(404).json({ error: 'Workspace not found' });
    if (workspace.user_id !== user_id) {
      return res.status(403).json({ error: 'Only the workspace owner can view audit logs' });
    }

    const { data, error } = await supabaseAdmin
      .from('auditlog')
      .select('*, user:user_id(avatar_url)')
      .eq('workspace_id', workspaceId)
      .order('created_at', { ascending: false })
      .limit(100);

    if (error) return res.status(500).json({ error: error.message });

    return res.json(data);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
};

module.exports = { createAuditLog, getAuditLogs };