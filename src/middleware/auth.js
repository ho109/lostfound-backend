const jwt = require('jsonwebtoken');

function signAdminToken(adminId) {
  return jwt.sign({ role: 'admin', adminId }, process.env.JWT_SECRET, { expiresIn: '12h' });
}

function authRequired(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'No token' });

  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    req.user = payload; // { role, adminId, iat, exp }
    next();
  } catch {
    return res.status(401).json({ error: 'Invalid token' });
  }
}

module.exports = { signAdminToken, authRequired };
