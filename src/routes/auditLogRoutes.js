const express = require('express');
const router = express.Router();
const { getAuditLogs } = require('../controllers/auditLogController');
const { authenticate } = require('../middleware/authMiddleware');

router.use(authenticate);
router.get('/:workspaceId', getAuditLogs);

module.exports = router;