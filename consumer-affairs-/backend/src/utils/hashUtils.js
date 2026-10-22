const crypto = require('crypto');

function computeHash(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

function verifyHash(buffer, expectedHash) {
  return computeHash(buffer) === expectedHash;
}

module.exports = {
  computeHash,
  verifyHash
};
