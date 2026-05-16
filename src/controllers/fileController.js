const supabase = require('../config/supabase');

// POST /api/files/upload
const uploadFile = async (req, res) => {
  try {
    const user_id = req.user.user_id;
    const { message_id } = req.body;
    const file = req.file;

    if (!file) return res.status(400).json({ error: 'No file provided' });

    // Check file size (1GB max)
    const MAX_SIZE = 1024 * 1024 * 1024;
    if (file.size > MAX_SIZE) {
      return res.status(400).json({ error: 'File size exceeds 1GB limit' });
    }

    // Upload to Supabase Storage
    const fileName = `${user_id}/${Date.now()}_${file.originalname}`;
    const { data: upload, error: uploadError } = await supabase.storage
      .from('linksphere-files')
      .upload(fileName, file.buffer, {
        contentType: file.mimetype,
        upsert: false,
      });

    if (uploadError) return res.status(500).json({ error: uploadError.message });

    // Get public URL
    const { data: urlData } = supabase.storage
      .from('linksphere-files')
      .getPublicUrl(fileName);

    // Save file record to database
    const { data: fileRecord, error: dbError } = await supabase
      .from('file')
      .insert({
        file_name: file.originalname,
        file_url: urlData.publicUrl,
        size: file.size,
        uploaded_at: new Date().toISOString(),
        user_id,
        message_id: message_id || null,
      })
      .select()
      .single();

    if (dbError) return res.status(500).json({ error: dbError.message });

    return res.status(201).json(fileRecord);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
};

// GET /api/files/message/:messageId
const getFilesByMessage = async (req, res) => {
  try {
    const { messageId } = req.params;

    const { data: files, error } = await supabase
      .from('file')
      .select('*')
      .eq('message_id', messageId);

    if (error) return res.status(500).json({ error: error.message });

    return res.json(files);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
};

// GET /api/files/my
const getMyFiles = async (req, res) => {
  try {
    const user_id = req.user.user_id;
    const { limit = 20 } = req.query;

    const { data: files, error } = await supabase
      .from('file')
      .select('*')
      .eq('user_id', user_id)
      .order('uploaded_at', { ascending: false })
      .limit(Number(limit));

    if (error) return res.status(500).json({ error: error.message });

    return res.json(files);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
};

// DELETE /api/files/:fileId
const deleteFile = async (req, res) => {
  try {
    const { fileId } = req.params;
    const user_id = req.user.user_id;

    // Get file record
    const { data: file } = await supabase
      .from('file')
      .select('*')
      .eq('file_id', fileId)
      .eq('user_id', user_id)
      .single();

    if (!file) return res.status(404).json({ error: 'File not found' });

    // Extract storage path from URL
    const urlParts = file.file_url.split('/linksphere-files/');
    const storagePath = urlParts[1];

    // Delete from Supabase Storage
    await supabase.storage
      .from('linksphere-files')
      .remove([storagePath]);

    // Delete from database
    const { error } = await supabase
      .from('file')
      .delete()
      .eq('file_id', fileId)
      .eq('user_id', user_id);

    if (error) return res.status(500).json({ error: error.message });

    return res.json({ message: 'File deleted successfully' });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
};

module.exports = {
  uploadFile,
  getFilesByMessage,
  getMyFiles,
  deleteFile,
};