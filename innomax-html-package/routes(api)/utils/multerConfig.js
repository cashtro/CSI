const multer = require('multer');
const path = require('path');

// Raster images only. The old filter accepted any client-declared image/*,
// including image/svg+xml: an SVG with a script, stored in a public bucket and
// served with its declared type, is a stored XSS on the storage domain.
const IMAGE_TYPES = {
  'image/jpeg': ['.jpg', '.jpeg'],
  'image/png': ['.png'],
  'image/webp': ['.webp'],
  'image/gif': ['.gif'],
  'image/avif': ['.avif'],
};

function isAllowedImage(file) {
  const exts = IMAGE_TYPES[String(file.mimetype).toLowerCase()];
  return Boolean(exts && exts.includes(path.extname(file.originalname || '').toLowerCase()));
}

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 5 * 1024 * 1024 // 5MB
  },
  fileFilter: (req, file, cb) => {
    if (isAllowedImage(file)) {
      cb(null, true);
    } else {
      cb(new Error('Seules les images JPEG, PNG, WebP, GIF ou AVIF sont autorisées'), false);
    }
  }
});

module.exports = upload;
module.exports.isAllowedImage = isAllowedImage;
