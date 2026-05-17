const express = require('express');
const router = express.Router();
const multer = require('multer');
const { authenticate } = require('../middleware/authMiddleware');
const {
  createWorkspace,
  getMyWorkspaces,
  getWorkspaceById,
  updateWorkspace,
  deleteWorkspace,
  uploadWorkspaceIcon,
  addMember,
  getMembers,
  removeMember,
  updateMemberRole,
  getInviteCode,
  regenerateInviteCode,
  joinByCode,
} = require('../controllers/workspaceController');

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 1024 * 1024 * 5 }, // 5MB
});

router.use(authenticate);

// Workspace CRUD
router.post('/', createWorkspace);
router.get('/', getMyWorkspaces);
router.get('/:workspaceId', getWorkspaceById);
router.patch('/:workspaceId', updateWorkspace);
router.delete('/:workspaceId', deleteWorkspace);

// Icon upload
router.patch('/:workspaceId/icon', (req, res, next) => {
  upload.single('icon')(req, res, (err) => {
    if (err) return res.status(400).json({ error: err.message });
    next();
  });
}, uploadWorkspaceIcon);

// Member management
router.post('/:workspaceId/members', addMember);
router.get('/:workspaceId/members', getMembers);
router.delete('/:workspaceId/members/:userId', removeMember);
router.patch('/:workspaceId/members/:userId', updateMemberRole);

// Invite code
router.get('/:workspaceId/invite', getInviteCode);
router.post('/:workspaceId/invite/regenerate', regenerateInviteCode);
router.post('/join', joinByCode);

module.exports = router;