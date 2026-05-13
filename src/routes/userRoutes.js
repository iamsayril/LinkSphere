const express = require('express');
const router = express.Router();
const {
  getProfile,
  updateProfile,
  updatePassword,
  searchUsers,
  getUserById,
  deleteAccount,
} = require('../controllers/userController');
const { authenticate } = require('../middleware/authMiddleware');

router.use(authenticate);

router.get('/profile', getProfile);
router.patch('/profile', updateProfile);
router.patch('/password', updatePassword);
router.get('/search', searchUsers);
router.get('/:userId', getUserById);
router.delete('/profile', deleteAccount);

module.exports = router;