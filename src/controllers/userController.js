const { supabase, supabaseAdmin } = require('../config/supabase');

// GET /api/users/profile
const getProfile = async (req, res) => {
  try {
    const user_id = req.user.user_id;

    const { data: user, error } = await supabase
      .from('user')
      .select('user_id, name, email, status, created_at')
      .eq('user_id', user_id)
      .single();

    if (!user || error) return res.status(404).json({ error: 'User not found' });

    return res.json(user);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
};

// PATCH /api/users/profile
const updateProfile = async (req, res) => {
  try {
    const user_id = req.user.user_id;
    const { name, status } = req.body;

    if (!name && !status) {
      return res.status(400).json({ error: 'name or status is required' });
    }

    const updates = {};
    if (name) updates.name = name;
    if (status) updates.status = status;

    const { data: user, error } = await supabase
      .from('user')
      .update(updates)
      .eq('user_id', user_id)
      .select('user_id, name, email, status, created_at')
      .single();

    if (error) return res.status(500).json({ error: error.message });

    return res.json(user);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
};

// PATCH /api/users/password
const updatePassword = async (req, res) => {
  try {
    const user_id = req.user.user_id;
    const { current_password, new_password } = req.body;

    if (!current_password || !new_password) {
      return res.status(400).json({ error: 'current_password and new_password are required' });
    }

    if (new_password.length < 6) {
      return res.status(400).json({ error: 'Password must be at least 6 characters' });
    }

    // Get user email
    const { data: user, error } = await supabase
      .from('user')
      .select('email')
      .eq('user_id', user_id)
      .single();

    if (!user || error) return res.status(404).json({ error: 'User not found' });

    // Verify current password by signing in
    const { error: signInError } = await supabase.auth.signInWithPassword({
      email:    user.email,
      password: current_password,
    });

    if (signInError) {
      return res.status(401).json({ error: 'Current password is incorrect' });
    }

    // Update password via Supabase Auth admin
    const { error: updateError } = await supabaseAdmin.auth.admin.updateUserById(
      user_id,
      { password: new_password }
    );

    if (updateError) {
      return res.status(500).json({ error: updateError.message });
    }

    return res.json({ message: 'Password updated successfully' });

  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
};

// GET /api/users/search?query=xxx
const searchUsers = async (req, res) => {
  try {
    const { query } = req.query;

    if (!query) return res.status(400).json({ error: 'query is required' });

    const { data: users, error } = await supabase
      .from('user')
      .select('user_id, name, email, status')
      .or(`name.ilike.%${query}%,email.ilike.%${query}%`)
      .limit(10);

    if (error) return res.status(500).json({ error: error.message });

    return res.json(users);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
};

// GET /api/users/:userId
const getUserById = async (req, res) => {
  try {
    const { userId } = req.params;

    const { data: user, error } = await supabase
      .from('user')
      .select('user_id, name, email, status, created_at')
      .eq('user_id', userId)
      .single();

    if (!user || error) return res.status(404).json({ error: 'User not found' });

    return res.json(user);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
};

// DELETE /api/users/profile
const deleteAccount = async (req, res) => {
  try {
    const user_id = req.user.user_id;
    const { password } = req.body;

    if (!password) return res.status(400).json({ error: 'password is required' });

    // Get user email
    const { data: user } = await supabase
      .from('user')
      .select('email')
      .eq('user_id', user_id)
      .single();

    if (!user) return res.status(404).json({ error: 'User not found' });

    // Verify password by signing in
    const { error: signInError } = await supabase.auth.signInWithPassword({
      email:    user.email,
      password: password,
    });

    if (signInError) {
      return res.status(401).json({ error: 'Incorrect password' });
    }

    // Delete from public.user table
    const { error: deleteError } = await supabase
      .from('user')
      .delete()
      .eq('user_id', user_id);

    if (deleteError) return res.status(500).json({ error: deleteError.message });

    // Delete from Supabase Auth
    const { error: authDeleteError } = await supabaseAdmin.auth.admin.deleteUser(user_id);

    if (authDeleteError) return res.status(500).json({ error: authDeleteError.message });

    return res.json({ message: 'Account deleted successfully' });

  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
};

module.exports = {
  getProfile,
  updateProfile,
  updatePassword,
  searchUsers,
  getUserById,
  deleteAccount,
};