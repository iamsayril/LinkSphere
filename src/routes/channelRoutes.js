const express = require('express');
const router = express.Router();
const {
  createChannel,
  getChannels,
  getChannel,
  joinChannel,
  leaveChannel,
  updateChannel,
  deleteChannel,
} = require('../controllers/channelController');
const {
  getMessages,
  sendMessage,
} = require('../controllers/messageController');
const { authenticate } = require('../middleware/authMiddleware');

router.use(authenticate);

router.post('/', createChannel);
router.get('/', getChannels);
router.get('/:channelId', getChannel);
router.post('/:channelId/join', joinChannel);
router.delete('/:channelId/leave', leaveChannel);
router.patch('/:channelId', updateChannel);
router.delete('/:channelId', deleteChannel);
router.get('/:channelId/messages', getMessages);
router.post('/:channelId/messages', sendMessage);

module.exports = router;