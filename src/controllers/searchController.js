const supabaseAdmin = require('../config/supabase');

// GET /api/search?query=xxx&type=messages|channels|users&workspace_id=xxx
const search = async (req, res) => {
  try {
    const { query, type, workspace_id } = req.query;
    const user_id = req.user.user_id;

    if (!query) return res.status(400).json({ error: 'query is required' });

    const results = {};

    // Search messages
    if (!type || type === 'messages') {
      const { data: messages, error } = await supabaseAdmin
        .from('message')
        .select(`
          message_id,
          content,
          created_at,
          channel_id,
          user:user_id (user_id, name, email)
        `)
        .ilike('content', `%${query}%`)
        .is('parent_message_id', null)
        .limit(20);

      if (!error) results.messages = messages;
    }

    // Search channels
    if (!type || type === 'channels') {
      let channelQuery = supabaseAdmin
        .from('channel')
        .select(`
          channel_id,
          name,
          created_at,
          workspace_id,
          channel_member!inner (user_id)
        `)
        .ilike('name', `%${query}%`)
        .eq('channel_member.user_id', user_id)
        .limit(10);

      if (workspace_id) {
        channelQuery = channelQuery.eq('workspace_id', workspace_id);
      }

      const { data: channels, error } = await channelQuery;
      if (!error) results.channels = channels;
    }

    // Search users
    if (!type || type === 'users') {
      const { data: users, error } = await supabaseAdmin
        .from('user')
        .select('user_id, name, email, status')
        .or(`name.ilike.%${query}%,email.ilike.%${query}%`)
        .limit(10);

      if (!error) results.users = users;
    }

    // Search workspaces
    if (!type || type === 'workspaces') {
      const { data: workspaces, error } = await supabaseAdmin
        .from('workspace')
        .select(`
          workspace_id,
          name,
          description,
          is_public,
          workspace_member!inner (user_id)
        `)
        .ilike('name', `%${query}%`)
        .eq('workspace_member.user_id', user_id)
        .limit(10);

      if (!error) results.workspaces = workspaces;
    }

    return res.json({
      query,
      type: type || 'all',
      results,
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
};

// GET /api/search/messages?query=xxx&channel_id=xxx
const searchMessages = async (req, res) => {
  try {
    const { query, channel_id } = req.query;
    const user_id = req.user.user_id;

    if (!query) return res.status(400).json({ error: 'query is required' });

    // Verify channel membership if channel_id provided
    if (channel_id) {
      const { data: member } = await supabaseAdmin
        .from('channel_member')
        .select('channel_member_id')
        .eq('channel_id', channel_id)
        .eq('user_id', user_id)
        .single();

      if (!member) return res.status(403).json({ error: 'You are not a member of this channel' });
    }

    let searchQuery = supabaseAdmin
      .from('message')
      .select(`
        message_id,
        content,
        created_at,
        updated_at,
        channel_id,
        parent_message_id,
        user:user_id (user_id, name, email)
      `)
      .ilike('content', `%${query}%`)
      .order('created_at', { ascending: false })
      .limit(50);

    if (channel_id) {
      searchQuery = searchQuery.eq('channel_id', channel_id);
    }

    const { data: messages, error } = await searchQuery;

    if (error) return res.status(500).json({ error: error.message });

    return res.json({
      query,
      count: messages.length,
      messages,
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
};

// GET /api/search/users?query=xxx&workspace_id=xxx
const searchUsers = async (req, res) => {
  try {
    const { query, workspace_id } = req.query;

    if (!query) return res.status(400).json({ error: 'query is required' });

    let searchQuery;

    if (workspace_id) {
      // Search within workspace members
      const { data: users, error } = await supabaseAdmin
        .from('workspace_member')
        .select('user_id, name, email, role, status')
        .eq('workspace_id', workspace_id)
        .or(`name.ilike.%${query}%,email.ilike.%${query}%`)
        .limit(10);

      if (error) return res.status(500).json({ error: error.message });
      return res.json({ query, count: users.length, users });
    }

    // Global user search
    const { data: users, error } = await supabaseAdmin
      .from('user')
      .select('user_id, name, email, status')
      .or(`name.ilike.%${query}%,email.ilike.%${query}%`)
      .limit(10);

    if (error) return res.status(500).json({ error: error.message });

    return res.json({ query, count: users.length, users });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
};

module.exports = {
  search,
  searchMessages,
  searchUsers,
};