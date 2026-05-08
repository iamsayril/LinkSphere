const express = require("express");
const router = express.Router();

const auth = require("../middleware/authMiddleware");

const {
  createWorkspace,
  getWorkspaces
} = require("../controllers/workspaceController");

router.post("/", auth, createWorkspace);
router.get("/", auth, getWorkspaces);

module.exports = router;