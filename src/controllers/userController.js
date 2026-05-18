const { supabase, supabaseAdmin } = require('../config/supabase');

// GET /api/users/profile
const getProfile = async (req, res) => {
  try {
    const user_id = req.user.user_id;

    const { data: user, error } = await supabaseAdmin
      .from('user')
      .select('user_id, name, email, status, avatar_url, created_at')
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
    const { name, status, email } = req.body; // ← FIX: extract email

    if (!name && !status && !email) {
      return res.status(400).json({ error: 'name, status, or email is required' });
    }

    // ── FIX: if email is changing, update Supabase Auth first ──
    if (email) {
      const { error: authError } = await supabaseAdmin.auth.admin.updateUserById(
        user_id,
        { email }
      );

      if (authError) {
        return res.status(500).json({ error: 'Failed to update email in auth: ' + authError.message });
      }
    }

    // ── Update the user table ──
    const updates = {};
    if (name)   updates.name   = name;
    if (status) updates.status = status;
    if (email)  updates.email  = email; // ← FIX: include email in DB update

    const { data: user, error } = await supabaseAdmin
      .from('user')
      .update(updates)
      .eq('user_id', user_id)
      .select('user_id, name, email, status, avatar_url, created_at')
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

    const { data: user, error } = await supabaseAdmin
      .from('user')
      .select('email')
      .eq('user_id', user_id)
      .single();

    if (!user || error) return res.status(404).json({ error: 'User not found' });

    const { error: signInError } = await supabaseAdmin.auth.signInWithPassword({
      email: user.email,
      password: current_password,
    });

    if (signInError) {
      return res.status(401).json({ error: 'Current password is incorrect' });
    }

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

// PATCH /api/users/avatar
const updateAvatar = async (req, res) => {
  try {
    const user_id = req.user.user_id;
    const file = req.file;

    if (!file) return res.status(400).json({ error: 'No file provided' });

    const allowedTypes = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
    if (!allowedTypes.includes(file.mimetype)) {
      return res.status(400).json({ error: 'Only JPG, PNG, GIF, WEBP allowed' });
    }

    const ext = file.originalname.split('.').pop();
    const fileName = `avatars/${user_id}/avatar_${Date.now()}.${ext}`;

    const { error: uploadError } = await supabaseAdmin.storage
      .from('linksphere-files')
      .upload(fileName, file.buffer, {
        contentType: file.mimetype,
        upsert: true,
      });

    if (uploadError) return res.status(500).json({ error: uploadError.message });

    const { data: urlData } = supabaseAdmin.storage
      .from('linksphere-files')
      .getPublicUrl(fileName);

    const { data: user, error } = await supabaseAdmin
      .from('user')
      .update({ avatar_url: urlData.publicUrl })
      .eq('user_id', user_id)
      .select('user_id, name, email, status, avatar_url, created_at')
      .single();

    if (error) return res.status(500).json({ error: error.message });

    return res.json(user);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
};

// GET /api/users/search?query=xxx
const searchUsers = async (req, res) => {
  try {
    const { query } = req.query;

    if (!query) return res.status(400).json({ error: 'query is required' });

    const { data: users, error } = await supabaseAdmin
      .from('user')
      .select('user_id, name, email, status, avatar_url')
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

    const { data: user, error } = await supabaseAdmin
      .from('user')
      .select('user_id, name, email, status, avatar_url, created_at')
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

    const { data: user } = await supabaseAdmin
      .from('user')
      .select('email')
      .eq('user_id', user_id)
      .single();

    if (!user) return res.status(404).json({ error: 'User not found' });

    const { error: signInError } = await supabaseAdmin.auth.signInWithPassword({
      email: user.email,
      password: password,
    });

    if (signInError) {
      return res.status(401).json({ error: 'Incorrect password' });
    }

    const { error: deleteError } = await supabaseAdmin
      .from('user')
      .delete()
      .eq('user_id', user_id);

    if (deleteError) return res.status(500).json({ error: deleteError.message });

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
  updateAvatar,
  searchUsers,
  getUserById,
  deleteAccount,
};