const express = require('express');
const router = express.Router();
const {
  sendMessage,
  getMessages,
  getThread,
  editMessage,
  deleteMessage,
  addReaction,
  removeReaction,
} = require('../controllers/messageController');
const { authenticate } = require('../middleware/authMiddleware');

router.use(authenticate); // all message routes require auth

router.post('/', sendMessage);
router.get('/:channelId', getMessages);
router.get('/:messageId/thread', getThread);
router.patch('/:messageId', editMessage);
router.delete('/:messageId', deleteMessage);
router.post('/:messageId/reactions', addReaction);
router.delete('/:messageId/reactions/:emoji', removeReaction);

module.exports = router;