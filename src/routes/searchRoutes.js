const express = require('express');
const router = express.Router();
const {
  search,
  searchMessages,
  searchUsers,
} = require('../controllers/searchController');
const { authenticate } = require('../middleware/authMiddleware');

router.use(authenticate);

router.get('/', search);
router.get('/messages', searchMessages);
router.get('/users', searchUsers);

module.exports = router;