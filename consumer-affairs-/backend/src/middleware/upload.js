const multer = require('multer');
const { UPLOAD_MAX_SIZE } = require('../config/env');

const storage = multer.memoryStorage();

// Parse size like '20MB'
const getBytes = (sizeStr) => {
  const match = sizeStr.match(/^(\d+)([a-zA-Z]*)$/);
  if (!match) return 20 * 1024 * 1024;
  const val = parseInt(match[1], 10);
  const unit = match[2].toUpperCase();
  if (unit === 'MB') return val * 1024 * 1024;
  if (unit === 'KB') return val * 1024;
  if (unit === 'GB') return val * 1024 * 1024 * 1024;
  return val;
};

const maxSize = getBytes(UPLOAD_MAX_SIZE);

// In a real implementation we would use file-type or mmmagic to sniff MIME from buffer,
// but for Multer configuration we check mimetype provided by the client as a basic filter.
const fileFilter = (req, file, cb) => {
  if (file.mimetype === 'image/jpeg' || file.mimetype === 'image/png') {
    cb(null, true);
  } else {
    cb(new Error('Unsupported file type. Only JPEG and PNG are allowed.'), false);
  }
};

const upload = multer({
  storage,
  limits: { fileSize: maxSize },
  fileFilter
});

module.exports = {
  single: upload.single('image'),
  array: upload.array('images', 10)
};
