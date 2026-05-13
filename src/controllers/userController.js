const supabase = require('../config/supabase');
const bcrypt = require('bcrypt');

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

    // Get current password hash
    const { data: user, error } = await supabase
      .from('user')
      .select('password_hash')
      .eq('user_id', user_id)
      .single();

    if (!user || error) return res.status(404).json({ error: 'User not found' });

    // Verify current password
    const validPassword = await bcrypt.compare(current_password, user.password_hash);
    if (!validPassword) {
      return res.status(401).json({ error: 'Current password is incorrect' });
    }

    // Hash new password
    const password_hash = await bcrypt.hash(new_password, 10);

    const { error: updateError } = await supabase
      .from('user')
      .update({ password_hash })
      .eq('user_id', user_id);

    if (updateError) return res.status(500).json({ error: updateError.message });

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

    // Verify password before deleting
    const { data: user } = await supabase
      .from('user')
      .select('password_hash')
      .eq('user_id', user_id)
      .single();

    const validPassword = await bcrypt.compare(password, user.password_hash);
    if (!validPassword) return res.status(401).json({ error: 'Incorrect password' });

    const { error } = await supabase
      .from('user')
      .delete()
      .eq('user_id', user_id);

    if (error) return res.status(500).json({ error: error.message });

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