const express = require('express');
const { db } = require('../config/firebase');
const { authRequired } = require('../middleware/auth');
const router = express.Router();

const ref = db.collection('settings').doc('schoolNotice');

router.get('/', async (_req, res) => {
  const snap = await ref.get();
  const items = snap.exists ? (snap.data().items || []) : [];
  res.json({ items });
});

router.post('/', authRequired, async (req, res) => {
  const text = (req.body.text || '').trim();
  if (!text) return res.status(400).json({ error: 'text required' });
  const snap = await ref.get();
  const list = snap.exists ? (snap.data().items || []) : [];
  list.push(text);
  await ref.set({ items: list });
  res.status(201).json({ ok: true });
});

router.delete('/:index', authRequired, async (req, res) => {
  const idx = Number(req.params.index);
  const snap = await ref.get();
  if (!snap.exists) return res.status(404).json({ error: 'not found' });
  const list = snap.data().items || [];
  if (idx < 0 || idx >= list.length) return res.status(400).json({ error: 'bad index' });
  list.splice(idx, 1);
  await ref.set({ items: list });
  res.json({ ok: true });
});

module.exports = router;
