const supabase = require('../config/supabase');

// ─── Create Workspace ────────────────────────────────────────────────────────
const createWorkspace = async (req, res) => {
  const { name, description, is_public = true } = req.body;
  const user_id = req.user.user_id;

  if (!name) {
    return res.status(400).json({ error: 'Workspace name is required' });
  }

  // Create workspace
  const { data: workspace, error: wsError } = await supabase
    .from('workspace')
    .insert({ name, description, owner_id: user_id, is_public })
    .select()
    .single();

  if (wsError) return res.status(500).json({ error: wsError.message });

  // Auto-add creator as owner member
  const { error: memberError } = await supabase
    .from('workspace_member')
    .insert({ workspace_id: workspace.id, user_id, role: 'owner' });

  if (memberError) return res.status(500).json({ error: memberError.message });

  // Emit socket event
  const io = req.app.get('io');
  if (io) io.emit('workspace:created', workspace);

  return res.status(201).json(workspace);
};

// ─── Get My Workspaces ───────────────────────────────────────────────────────
const getMyWorkspaces = async (req, res) => {
  const user_id = req.user.user_id;

  const { data, error } = await supabase
    .from('workspace_member')
    .select(`
      role,
      joined_at,
      workspace (
        id, name, description, is_public, owner_id, created_at
      )
    `)
    .eq('user_id', user_id);

  if (error) return res.status(500).json({ error: error.message });

  const workspaces = data.map((m) => ({
    ...m.workspace,
    my_role: m.role,
    joined_at: m.joined_at,
  }));

  return res.status(200).json(workspaces);
};

// ─── Get Workspace By ID ─────────────────────────────────────────────────────
const getWorkspaceById = async (req, res) => {
  const { workspaceId } = req.params;
  const user_id = req.user.user_id;

  // Check membership
  const { data: member, error: memberError } = await supabase
    .from('workspace_member')
    .select('role')
    .eq('workspace_id', workspaceId)
    .eq('user_id', user_id)
    .single();

  if (memberError || !member) {
    return res.status(403).json({ error: 'You are not a member of this workspace' });
  }

  const { data: workspace, error } = await supabase
    .from('workspace')
    .select('*')
    .eq('id', workspaceId)
    .single();

  if (error || !workspace) return res.status(404).json({ error: 'Workspace not found' });

  return res.status(200).json({ ...workspace, my_role: member.role });
};

// ─── Update Workspace ────────────────────────────────────────────────────────
const updateWorkspace = async (req, res) => {
  const { workspaceId } = req.params;
  const user_id = req.user.user_id;
  const { name, description, is_public } = req.body;

  // Only owner/admin can update
  const { data: member } = await supabase
    .from('workspace_member')
    .select('role')
    .eq('workspace_id', workspaceId)
    .eq('user_id', user_id)
    .single();

  if (!member || !['owner', 'admin'].includes(member.role)) {
    return res.status(403).json({ error: 'Only owners and admins can update the workspace' });
  }

  const updates = {};
  if (name !== undefined) updates.name = name;
  if (description !== undefined) updates.description = description;
  if (is_public !== undefined) updates.is_public = is_public;

  const { data, error } = await supabase
    .from('workspace')
    .update(updates)
    .eq('id', workspaceId)
    .select()
    .single();

  if (error) return res.status(500).json({ error: error.message });

  const io = req.app.get('io');
  if (io) io.to(`workspace:${workspaceId}`).emit('workspace:updated', data);

  return res.status(200).json(data);
};

// ─── Delete Workspace ────────────────────────────────────────────────────────
const deleteWorkspace = async (req, res) => {
  const { workspaceId } = req.params;
  const user_id = req.user.user_id;

  // Only owner can delete
  const { data: workspace } = await supabase
    .from('workspace')
    .select('owner_id')
    .eq('id', workspaceId)
    .single();

  if (!workspace) return res.status(404).json({ error: 'Workspace not found' });
  if (workspace.owner_id !== user_id) {
    return res.status(403).json({ error: 'Only the workspace owner can delete it' });
  }

  const { error } = await supabase.from('workspace').delete().eq('id', workspaceId);
  if (error) return res.status(500).json({ error: error.message });

  const io = req.app.get('io');
  if (io) io.emit('workspace:deleted', { workspaceId });

  return res.status(200).json({ message: 'Workspace deleted successfully' });
};

// ─── Add Member ──────────────────────────────────────────────────────────────
const addMember = async (req, res) => {
  const { workspaceId } = req.params;
  const { user_id: target_user_id, role = 'member' } = req.body;
  const requester_id = req.user.user_id;

  if (!target_user_id) {
    return res.status(400).json({ error: 'user_id is required' });
  }

  // Only owner/admin can add members
  const { data: requester } = await supabase
    .from('workspace_member')
    .select('role')
    .eq('workspace_id', workspaceId)
    .eq('user_id', requester_id)
    .single();

  if (!requester || !['owner', 'admin'].includes(requester.role)) {
    return res.status(403).json({ error: 'Only owners and admins can add members' });
  }

  // Check if already a member
  const { data: existing } = await supabase
    .from('workspace_member')
    .select('id')
    .eq('workspace_id', workspaceId)
    .eq('user_id', target_user_id)
    .single();

  if (existing) {
    return res.status(409).json({ error: 'User is already a member of this workspace' });
  }

  const { data, error } = await supabase
    .from('workspace_member')
    .insert({ workspace_id: workspaceId, user_id: target_user_id, role })
    .select()
    .single();

  if (error) return res.status(500).json({ error: error.message });

  const io = req.app.get('io');
  if (io) io.to(`workspace:${workspaceId}`).emit('workspace:member_added', data);

  return res.status(201).json(data);
};

// ─── Get Members ─────────────────────────────────────────────────────────────
const getMembers = async (req, res) => {
  const { workspaceId } = req.params;
  const user_id = req.user.user_id;

  // Must be a member to view
  const { data: self } = await supabase
    .from('workspace_member')
    .select('role')
    .eq('workspace_id', workspaceId)
    .eq('user_id', user_id)
    .single();

  if (!self) {
    return res.status(403).json({ error: 'You are not a member of this workspace' });
  }

  const { data, error } = await supabase
    .from('workspace_member')
    .select(`
      role,
      joined_at,
      user (
        id, name, email, status, avatar_url
      )
    `)
    .eq('workspace_id', workspaceId);

  if (error) return res.status(500).json({ error: error.message });

  const members = data.map((m) => ({
    ...m.user,
    role: m.role,
    joined_at: m.joined_at,
  }));

  return res.status(200).json(members);
};

// ─── Remove Member ───────────────────────────────────────────────────────────
const removeMember = async (req, res) => {
  const { workspaceId, userId } = req.params;
  const requester_id = req.user.user_id;

  // Allow self-leave OR owner/admin removal
  if (requester_id !== userId) {
    const { data: requester } = await supabase
      .from('workspace_member')
      .select('role')
      .eq('workspace_id', workspaceId)
      .eq('user_id', requester_id)
      .single();

    if (!requester || !['owner', 'admin'].includes(requester.role)) {
      return res.status(403).json({ error: 'Only owners and admins can remove members' });
    }
  }

  // Cannot remove the owner
  const { data: workspace } = await supabase
    .from('workspace')
    .select('owner_id')
    .eq('id', workspaceId)
    .single();

  if (workspace?.owner_id === userId) {
    return res.status(400).json({ error: 'Cannot remove the workspace owner' });
  }

  const { error } = await supabase
    .from('workspace_member')
    .delete()
    .eq('workspace_id', workspaceId)
    .eq('user_id', userId);

  if (error) return res.status(500).json({ error: error.message });

  const io = req.app.get('io');
  if (io) io.to(`workspace:${workspaceId}`).emit('workspace:member_removed', { userId });

  return res.status(200).json({ message: 'Member removed successfully' });
};

// ─── Update Member Role ──────────────────────────────────────────────────────
const updateMemberRole = async (req, res) => {
  const { workspaceId, userId } = req.params;
  const { role } = req.body;
  const requester_id = req.user.user_id;

  const validRoles = ['admin', 'member'];
  if (!role || !validRoles.includes(role)) {
    return res.status(400).json({ error: `Role must be one of: ${validRoles.join(', ')}` });
  }

  // Only owner can change roles
  const { data: workspace } = await supabase
    .from('workspace')
    .select('owner_id')
    .eq('id', workspaceId)
    .single();

  if (!workspace) return res.status(404).json({ error: 'Workspace not found' });
  if (workspace.owner_id !== requester_id) {
    return res.status(403).json({ error: 'Only the workspace owner can change roles' });
  }

  const { data, error } = await supabase
    .from('workspace_member')
    .update({ role })
    .eq('workspace_id', workspaceId)
    .eq('user_id', userId)
    .select()
    .single();

  if (error) return res.status(500).json({ error: error.message });

  return res.status(200).json(data);
};

module.exports = {
  createWorkspace,
  getMyWorkspaces,
  getWorkspaceById,
  updateWorkspace,
  deleteWorkspace,
  addMember,
  getMembers,
  removeMember,
  updateMemberRole,
};