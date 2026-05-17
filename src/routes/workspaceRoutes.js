const express = require('express');
const router = express.Router();
const { authenticate } = require('../middleware/authMiddleware');
const {
  createWorkspace,
  getMyWorkspaces,
  getWorkspaceById,
  updateWorkspace,
  deleteWorkspace,
  addMember,
  getMembers,
  removeMember,
  updateMemberRole,
  getInviteCode,
  regenerateInviteCode,
  joinByCode,
} = require('../controllers/workspaceController');

// All routes require authentication
router.use(authenticate);

// Workspace CRUD
router.post('/', createWorkspace);
router.get('/', getMyWorkspaces);
router.get('/:workspaceId', getWorkspaceById);
router.patch('/:workspaceId', updateWorkspace);
router.delete('/:workspaceId', deleteWorkspace);

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