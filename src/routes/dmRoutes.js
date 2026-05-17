const express = require('express');
const router  = express.Router();
const { authenticate } = require('../middleware/authMiddleware');
const {
  getConversations,
  getDmMessages,
  sendDm,
} = require('../controllers/dmController');

router.use(authenticate);

router.get('/conversations', getConversations);  // GET  /api/dm/conversations
router.get('/:userId', getDmMessages);            // GET  /api/dm/:userId
router.post('/', sendDm);                         // POST /api/dm

module.exports = router;