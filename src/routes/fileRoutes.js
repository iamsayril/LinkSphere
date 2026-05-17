const express = require('express');
const router = express.Router();
const multer = require('multer');
const {
  uploadFile,
  getFilesByMessage,
  getMyFiles,
  deleteFile,
} = require('../controllers/fileController');
const { authenticate } = require('../middleware/authMiddleware');

// ✅ Fixed: was 100MB — now matches the 1GB check in fileController.js
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 1024 * 1024 * 1024 }, // 1 GB
  fileFilter: (_req, _file, cb) => cb(null, true), // allow all file types
});

router.use(authenticate);

router.post('/upload', (req, res, next) => {
  upload.single('file')(req, res, (err) => {
    if (err instanceof multer.MulterError) {
      if (err.code === 'LIMIT_FILE_SIZE') {
        return res.status(400).json({ error: 'File size exceeds the 1 GB limit.' });
      }
      return res.status(400).json({ error: err.message });
    }
    if (err) {
      console.error('Multer error:', err);
      return res.status(400).json({ error: err.message });
    }
    next();
  });
}, uploadFile);

router.get('/my', getMyFiles);
router.get('/message/:messageId', getFilesByMessage);
router.delete('/:fileId', deleteFile);

module.exports = router;