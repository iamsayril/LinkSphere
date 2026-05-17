const express = require('express');
const router = express.Router();
const multer = require('multer');
const {
  getProfile,
  updateProfile,
  updatePassword,
  updateAvatar,
  searchUsers,
  getUserById,
  deleteAccount,
} = require('../controllers/userController');
const { authenticate } = require('../middleware/authMiddleware');

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 1024 * 1024 * 5 }, // 5MB max for avatars
});

router.use(authenticate);

router.get('/profile', getProfile);
router.patch('/profile', updateProfile);
router.patch('/password', updatePassword);
router.patch('/avatar', (req, res, next) => {
  upload.single('avatar')(req, res, (err) => {
    if (err) return res.status(400).json({ error: err.message });
    next();
  });
}, updateAvatar);
router.get('/search', searchUsers);
router.get('/:userId', getUserById);
router.delete('/profile', deleteAccount);

module.exports = router;