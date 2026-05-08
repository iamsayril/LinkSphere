const express = require("express");
const router = express.Router();

const auth = require("../middleware/authMiddleware");

const {
  createChannel,
  getChannels
} = require("../controllers/channelController");

router.post("/", auth, createChannel);

router.get("/:workspaceId", auth, getChannels);

module.exports = router;