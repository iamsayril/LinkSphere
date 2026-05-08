const supabase = require("../config/supabase");

exports.createWorkspace = async (req, res) => {
  try {

    const { name } = req.body;

    const { data, error } = await supabase
      .from("workspace")
      .insert([
        {
          name,
          user_id: req.user.id
        }
      ])
      .select()
      .single();

    if (error) {
      return res.status(400).json(error);
    }

    res.status(201).json(data);

  } catch (err) {
    res.status(500).json({
      message: err.message
    });
  }
};

exports.getWorkspaces = async (req, res) => {

  const { data, error } = await supabase
    .from("workspace")
    .select("*");

  res.json(data);
};