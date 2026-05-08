const jwt = require("jsonwebtoken");
const bcrypt = require("bcrypt");
const supabase = require("../config/supabase");

exports.login = async (req, res) => {

  try {

    const { email, password } = req.body;

    const { data: user, error } = await supabase
      .from("user")
      .select("*")
      .eq("email", email)
      .single();

    if (!user || error) {
      return res.status(401).json({
        message: "User not found"
      });
    }

    const validPassword = await bcrypt.compare(
      password,
      user.password_hash
    );

    if (!validPassword) {
      return res.status(401).json({
        message: "Invalid password"
      });
    }

    const token = jwt.sign(
      {
        id: user.user_id,
        email: user.email
      },
      process.env.JWT_SECRET,
      {
        expiresIn: "7d"
      }
    );

    res.json({
      token,
      user
    });

  } catch (err) {

    res.status(500).json({
      message: err.message
    });

  }

};