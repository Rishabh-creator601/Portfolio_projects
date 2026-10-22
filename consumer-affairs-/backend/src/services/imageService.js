const sharp = require('sharp');
const crypto = require('crypto');

async function processImage(buffer, mimeType) {
  const metadata = await sharp(buffer).metadata();
  const compressed = await sharp(buffer)
    .resize(800, null, { withoutEnlargement: true })
    .jpeg({ quality: 60 })
    .toBuffer();

  return {
    original: buffer,
    compressed,
    metadata: {
      width: metadata.width,
      height: metadata.height,
      format: metadata.format,
      exif: metadata.exif ? metadata.exif.toString('base64') : null,
    }
  };
}

async function saveToGridFS(bucket, buffer, filename, metadata) {
  return new Promise((resolve, reject) => {
    const uploadStream = bucket.openUploadStream(filename, { metadata });
    uploadStream.end(buffer);
    uploadStream.on('finish', () => resolve(uploadStream.id));
    uploadStream.on('error', reject);
  });
}

async function readFromGridFS(bucket, fileId) {
  return new Promise((resolve, reject) => {
    const downloadStream = bucket.openDownloadStream(fileId);
    const chunks = [];
    downloadStream.on('data', chunk => chunks.push(chunk));
    downloadStream.on('error', reject);
    downloadStream.on('end', () => resolve(Buffer.concat(chunks)));
  });
}

function computeImageHash(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

async function getImageMetadata(buffer) {
  const meta = await sharp(buffer).metadata();
  return {
    width: meta.width,
    height: meta.height,
    format: meta.format,
    exif: meta.exif ? meta.exif.toString('base64') : null,
  };
}

module.exports = { processImage, saveToGridFS, readFromGridFS, computeImageHash, getImageMetadata };
