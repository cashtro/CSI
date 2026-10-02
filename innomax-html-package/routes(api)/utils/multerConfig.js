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

// The declared type and the extension come from the browser. The first bytes
// of the file must also match that type, so an HTML or SVG page renamed
// "photo.png" is refused before it reaches the public bucket.
function matchesImageSignature(buffer, mimetype) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 12) return false;
  const ascii = (start, end) => buffer.subarray(start, end).toString('latin1');
  switch (String(mimetype).toLowerCase()) {
    case 'image/jpeg': return buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
    case 'image/png': return buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
    case 'image/gif': return ascii(0, 6) === 'GIF87a' || ascii(0, 6) === 'GIF89a';
    case 'image/webp': return ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WEBP';
    case 'image/avif': return ascii(4, 8) === 'ftyp' && /^avi[fs]$/.test(ascii(8, 12));
    default: return false;
  }
}

// Extension used for the stored name, derived from the verified type.
function extensionFor(mimetype) {
  const exts = IMAGE_TYPES[String(mimetype).toLowerCase()];
  return exts ? exts[0] : null;
}

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 5 * 1024 * 1024, // 5MB
    files: 1,
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
module.exports.matchesImageSignature = matchesImageSignature;
module.exports.extensionFor = extensionFor;
