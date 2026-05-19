const express = require('express');
const router  = express.Router();
const { authenticate } = require('../middleware/authMiddleware');
const {
  getConversations,
  getDmMessages,
  sendDm,
  uploadDmFile,
  proxyVideo,
  addDmReaction,    // add
  removeDmReaction,
} = require('../controllers/dmController');

router.use(authenticate);

router.get('/conversations', getConversations);  // GET  /api/dm/conversations
router.get('/proxy-video',   proxyVideo);         // GET  /api/dm/proxy-video?url=...
router.post('/upload',       uploadDmFile);       // POST /api/dm/upload
router.post('/',             sendDm);             // POST /api/dm
router.get('/:userId',       getDmMessages);      // GET  /api/dm/:userId  ← must be last

module.exports = router;