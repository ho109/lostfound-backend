const admin = require('firebase-admin');
const path = require('path');

const keyPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
if (!keyPath) {
  throw new Error('GOOGLE_APPLICATION_CREDENTIALS is not set');
}
const serviceAccount = require(path.resolve(keyPath));

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

const db = admin.firestore();
module.exports = { admin, db };
