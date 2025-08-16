const express = require('express');
const router = express.Router();
const { signAdminToken } = require('../middleware/auth');

router.post('/login', (req, res) => {
  const { id, password } = req.body || {};
  if (!id || !password) return res.status(400).json({ error: 'id/password required' });

  if (id === process.env.ADMIN_ID && password === process.env.ADMIN_PW) {
    const token = signAdminToken(id);
    return res.json({ token });
  }
  return res.status(401).json({ error: 'Invalid credentials' });
});

module.exports = router;
