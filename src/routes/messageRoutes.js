const express = require("express");
const router = express.Router();

const auth = require("../middleware/authMiddleware");

const {
  sendMessage,
  getMessages
} = require("../controllers/messageController");

router.post("/", auth, sendMessage);

router.get("/:channelId", auth, getMessages);

module.exports = router;