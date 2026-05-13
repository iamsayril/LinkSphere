const jwt = require("jsonwebtoken");
const bcrypt = require("bcrypt");
const supabase = require("../config/supabase");

exports.register = async (req, res) => {
  try {
    const { name, email, password } = req.body;

    if (!name || !email || !password) {
      return res.status(400).json({ message: "name, email and password are required" });
    }

    // Check if email already exists
    const { data: existing } = await supabase
      .from("user")
      .select("user_id")
      .eq("email", email)
      .single();

    if (existing) {
      return res.status(409).json({ message: "Email already in use" });
    }

    const password_hash = await bcrypt.hash(password, 10);

    const { data: user, error } = await supabase
      .from("user")
      .insert({
        name,
        email,
        password_hash,
        status: "active",
        created_at: new Date().toISOString(),
      })
      .select("user_id, name, email, status, created_at")
      .single();

    if (error) return res.status(500).json({ message: error.message });

    const token = jwt.sign(
      { user_id: user.user_id, email: user.email },
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRES_IN || "7d" }
    );

    return res.status(201).json({ token, user });
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
};

exports.login = async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ message: "email and password are required" });
    }

    const { data: user, error } = await supabase
      .from("user")
      .select("*")
      .eq("email", email)
      .single();

    if (!user || error) {
      return res.status(401).json({ message: "User not found" });
    }

    const validPassword = await bcrypt.compare(password, user.password_hash);

    if (!validPassword) {
      return res.status(401).json({ message: "Invalid password" });
    }

    const token = jwt.sign(
      { user_id: user.user_id, email: user.email },
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRES_IN || "7d" }
    );

    // Don't return password_hash
    const { password_hash, ...safeUser } = user;

    return res.json({ token, user: safeUser });
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
};

exports.me = async (req, res) => {
  try {
    const { data: user, error } = await supabase
      .from("user")
      .select("user_id, name, email, status, created_at")
      .eq("user_id", req.user.user_id)
      .single();

    if (!user || error) return res.status(404).json({ message: "User not found" });

    return res.json(user);
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
};