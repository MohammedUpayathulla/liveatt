'use strict';

const multer = require('multer');
const path   = require('path');
const fs     = require('fs');
const cfg    = require('../config/index');

// Ensure the upload directory exists
const uploadDir = path.join(__dirname, '..', 'uploads', 'faces');
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, uploadDir);
  },
  filename: function (req, file, cb) {
    const uniqueName = Date.now() + '-' + file.originalname.replace(/\s+/g, '_');
    cb(null, uniqueName);
  }
});

function fileFilter(req, file, cb) {
  const allowed = ['image/jpeg', 'image/jpg', 'image/png'];
  if (allowed.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new Error('Only JPEG and PNG image files are allowed.'), false);
  }
}

const upload = multer({
  storage,
  fileFilter,
  limits: { fileSize: cfg.MAX_FILE_SIZE },
});

module.exports = { upload };
