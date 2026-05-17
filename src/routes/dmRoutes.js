const express = require('express');
const router  = express.Router();
const { authenticate } = require('../middleware/authMiddleware');
const {
  getConversations,
  getDmMessages,
  sendDm,
} = require('../controllers/dmController');

router.use(authenticate);

router.get('/conversations', getConversations);   // GET  /api/messages/conversations
router.get('/dm/:userId',    getDmMessages);       // GET  /api/messages/dm/:userId
router.post('/dm',           sendDm);              // POST /api/messages/dm

module.exports = router;