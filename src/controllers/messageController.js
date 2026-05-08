const supabase = require("../config/supabase");

exports.sendMessage = async (req, res) => {
  try {

    const { content, channel_id } = req.body;

    const { data, error } = await supabase
      .from("message")
      .insert([
        {
          content,
          channel_id,
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

exports.getMessages = async (req, res) => {

  const { channelId } = req.params;

  const { data } = await supabase
    .from("message")
    .select(`
      *,
      user (
        name,
        email
      )
    `)
    .eq("channel_id", channelId)
    .order("created_at", {
      ascending: true
    });

  res.json(data);
};