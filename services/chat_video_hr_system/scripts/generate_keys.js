const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const secretsDir = path.resolve(__dirname, '..', 'secrets');
if (!fs.existsSync(secretsDir)) {
  fs.mkdirSync(secretsDir, { recursive: true });
}

const privateKeyPath = path.join(secretsDir, 'jwt_private_key.pem');
const publicKeyPath = path.join(secretsDir, 'jwt_public_key.pem');

if (fs.existsSync(privateKeyPath) && fs.existsSync(publicKeyPath)) {
  console.log('RSA keys already exist in secrets/ directory. Skipping generation.');
  process.exit(0);
}

console.log('Generating 2048-bit RSA key pair for JWT signing...');
const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', {
  modulusLength: 2048,
  publicKeyEncoding: {
    type: 'spki',
    format: 'pem'
  },
  privateKeyEncoding: {
    type: 'pkcs8',
    format: 'pem'
  }
});

fs.writeFileSync(privateKeyPath, privateKey, { mode: 0o600 });
fs.writeFileSync(publicKeyPath, publicKey, { mode: 0o644 });

console.log('Keys generated successfully:');
console.log('  - ' + privateKeyPath);
console.log('  - ' + publicKeyPath);
