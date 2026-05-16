const express = require('express');
const router = express.Router();
const {
  getAllUsers,
  updateUserStatus,
  deleteUser,
  getAllWorkspaces,
  deleteWorkspace,
  getStats,
  getAuditLogs,
} = require('../controllers/adminController');
const { authenticate } = require('../middleware/authMiddleware');
const { requireAdmin } = require('../middleware/roleMiddleware');

router.use(authenticate);
router.use(requireAdmin);

router.get('/stats', getStats);
router.get('/users', getAllUsers);
router.patch('/users/:userId/status', updateUserStatus);
router.delete('/users/:userId', deleteUser);
router.get('/workspaces', getAllWorkspaces);
router.delete('/workspaces/:workspaceId', deleteWorkspace);
router.get('/audit-logs', getAuditLogs);

module.exports = router;