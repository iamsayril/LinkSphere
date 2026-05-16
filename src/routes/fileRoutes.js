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

// Multer config - store in memory
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 1024 * 1024 * 100 }, // 100MB for now
});

router.use(authenticate);

router.post('/upload', (req, res, next) => {
  upload.single('file')(req, res, (err) => {
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