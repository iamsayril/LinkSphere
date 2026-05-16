const express = require('express');
const router = express.Router();
const {
  getNotifications,
  markAsRead,
  markAllAsRead,
  deleteNotification,
  deleteAllNotifications,
  createNotification,
  getUnreadCount,
} = require('../controllers/notificationController');
const { authenticate } = require('../middleware/authMiddleware');

router.use(authenticate);

router.get('/', getNotifications);
router.get('/unread-count', getUnreadCount);
router.post('/', createNotification);
router.patch('/read-all', markAllAsRead);
router.patch('/:notificationId/read', markAsRead);
router.delete('/', deleteAllNotifications);
router.delete('/:notificationId', deleteNotification);

module.exports = router;