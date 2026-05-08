const supabase = require("../config/supabase");

exports.createChannel = async (req, res) => {

  try {

    const { workspace_id, name } = req.body;

    const { data, error } = await supabase
      .from("channel")
      .insert([
        {
          workspace_id,
          name
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

exports.getChannels = async (req, res) => {

  const { workspaceId } = req.params;

  const { data } = await supabase
    .from("channel")
    .select("*")
    .eq("workspace_id", workspaceId);

  res.json(data);
};