const jwt                        = require('jsonwebtoken');
const { supabase, supabaseAdmin } = require('../config/supabase');

// ─── Helper: generate your app JWT from a user row ───────────────────────────
function makeToken(user) {
  return jwt.sign(
    { user_id: user.user_id, email: user.email, name: user.name },
    process.env.JWT_SECRET,
    { expiresIn: process.env.JWT_EXPIRES_IN || '7d' }
  );
}

// ─── Helper: safe user object (no sensitive fields) ──────────────────────────
function safeUser(user) {
  const { password_hash, ...rest } = user;
  return rest;
}

// ─── POST /api/auth/register ──────────────────────────────────────────────────
exports.register = async (req, res) => {
  try {
    const { name, email, password } = req.body;

    if (!name || !email || !password)
      return res.status(400).json({ message: 'name, email and password are required' });

    if (password.length < 6)
      return res.status(400).json({ message: 'Password must be at least 6 characters' });

    const { data: authData, error: authError } = await supabase.auth.signUp({
      email,
      password,
      options: { data: { name } }
    });

    if (authError) {
      if (authError.message.toLowerCase().includes('already registered'))
        return res.status(409).json({ message: 'Email already in use' });
      return res.status(400).json({ message: authError.message });
    }

    const authUser = authData.user;
    console.log('AUTH USER:', authUser);

    const { data: existing } = await supabase
      .from('user')
      .select('user_id')
      .eq('email', email)
      .single();

    if (!existing) {
      const { data: insertData, error: insertError } = await supabase
        .from('user')
        .insert({
          user_id:    authUser.id,
          name,
          email,
          status:     'pending',
          created_at: new Date().toISOString(),
        });

      console.log('INSERT ERROR:', insertError);
      console.log('INSERT DATA:', insertData);

      if (insertError) {
        return res.status(500).json({ message: insertError.message, details: insertError });
      }
    }

    if (authData.session) {
      const { data: user } = await supabase
        .from('user')
        .select('user_id, name, email, status, created_at')
        .eq('email', email)
        .single();

      return res.status(201).json({ token: makeToken(user), user: safeUser(user) });
    }

    return res.status(201).json({
      message: 'Confirmation email sent. Please check your inbox.'
    });

  } catch (err) {
    console.log('REGISTER CATCH ERROR:', err);
    return res.status(500).json({ message: err.message });
  }
};

// ─── POST /api/auth/login ─────────────────────────────────────────────────────
exports.login = async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password)
      return res.status(400).json({ message: 'email and password are required' });

    const { data: authData, error: authError } = await supabase.auth.signInWithPassword({
      email,
      password
    });

    if (authError) {
      if (authError.message.toLowerCase().includes('email not confirmed'))
        return res.status(401).json({ message: 'Please confirm your email before logging in.' });
      return res.status(401).json({ message: 'Invalid email or password' });
    }

    const { data: user, error } = await supabaseAdmin
      .from('user')
      .select('user_id, name, email, status, created_at')
      .eq('email', email)
      .single();

    if (!user || error)
      return res.status(404).json({ message: 'User profile not found' });

    if (user.status === 'pending') {
      await supabaseAdmin.from('user').update({ status: 'active' }).eq('email', email);
      user.status = 'active';
    }

    return res.json({ token: makeToken(user), user: safeUser(user) });

  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
};

// ─── GET /api/auth/me ─────────────────────────────────────────────────────────
exports.me = async (req, res) => {
  try {
    const { data: user, error } = await supabaseAdmin
      .from('user')
      .select('user_id, name, email, status, created_at')
      .eq('user_id', req.user.user_id)
      .single();

    if (!user || error)
      return res.status(404).json({ message: 'User not found' });

    return res.json(user);
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
};

// ─── POST /api/auth/confirm ───────────────────────────────────────────────────
exports.confirm = async (req, res) => {
  try {
    const { token_hash, type } = req.body;

    if (!token_hash || !type)
      return res.status(400).json({ message: 'token_hash and type are required' });

    const { data, error } = await supabaseAdmin.auth.verifyOtp({ token_hash, type });

    if (error || !data.user)
      return res.status(400).json({ message: 'Invalid or expired confirmation link' });

    const email = data.user.email;

    let { data: user } = await supabaseAdmin
      .from('user')
      .select('user_id, name, email, status, created_at')
      .eq('email', email)
      .single();

    if (!user) {
      const name = data.user.user_metadata?.name || email.split('@')[0];
      const { data: newUser, error: insertError } = await supabaseAdmin
        .from('user')
        .insert({
          user_id:    data.user.id,
          name,
          email,
          status:     'active',
          created_at: new Date().toISOString()
        })
        .select('user_id, name, email, status, created_at')
        .single();

      console.log('CONFIRM INSERT ERROR:', insertError);
      user = newUser;
    } else if (user.status === 'pending') {
      await supabaseAdmin.from('user').update({ status: 'active' }).eq('email', email);
      user.status = 'active';
    }

    return res.json({ token: makeToken(user), user: safeUser(user) });

  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
};

// ─── POST /api/auth/session ───────────────────────────────────────────────────
exports.session = async (req, res) => {
  try {
    const { access_token, refresh_token } = req.body;

    if (!access_token)
      return res.status(400).json({ message: 'access_token is required' });

    const { data, error } = await supabaseAdmin.auth.getUser(access_token);

    if (error || !data.user)
      return res.status(401).json({ message: 'Invalid or expired token' });

    const email = data.user.email;

    let { data: user } = await supabaseAdmin
      .from('user')
      .select('user_id, name, email, status, created_at')
      .eq('email', email)
      .single();

    if (!user) {
      const name = data.user.user_metadata?.name || email.split('@')[0];
      const { data: newUser, error: insertError } = await supabaseAdmin
        .from('user')
        .insert({
          user_id:    data.user.id,
          name,
          email,
          status:     'active',
          created_at: new Date().toISOString()
        })
        .select('user_id, name, email, status, created_at')
        .single();

      console.log('SESSION INSERT ERROR:', insertError);
      user = newUser;
    }

    return res.json({ token: makeToken(user), user: safeUser(user) });

  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
};