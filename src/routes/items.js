// src/routes/items.js
'use strict';

const express = require('express');
const { db } = require('../config/firebase');
const { authRequired } = require('../middleware/auth');
const multer = require('multer');

const router = express.Router();

const FLOORS = [1, 2, 3, 4];
const COL = 'lostItems';
const docId = (f) => `floor${f}`;

// 디스크 대신 메모리 버퍼 사용
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 3 * 1024 * 1024 }, // 3MB 제한 (문서 크기 보호)
});

// 유틸
const genId = () => String(Date.now()) + Math.random().toString(36).slice(2, 7);

const toDataURL = (file) => {
  if (!file || !file.buffer) return null;
  const mime = file.mimetype || 'image/jpeg';
  const b64 = file.buffer.toString('base64');
  return `data:${mime};base64,${b64}`;
};

const readFloorItems = async (floor) => {
  const snap = await db.collection(COL).doc(docId(floor)).get();
  return snap.exists ? (snap.data().items || []) : [];
};
const writeFloorItems = (floor, items) =>
  db.collection(COL).doc(docId(floor)).set({ items });

const normalizeItem = (it, floor, req) => {
  // image(data URL) 우선, 그 다음 imageUrl(옛 데이터)
  let image = it.image || null;
  let imageUrl = it.imageUrl || null;

  // 예전 '/uploads/..' 상대경로가 남아있다면 절대경로로 보정
  if (!image && imageUrl && imageUrl.startsWith('/')) {
    imageUrl = `${req.protocol}://${req.get('host')}${imageUrl}`;
  }
  return { ...it, floor, image, imageUrl };
};

const findItemById = async (id) => {
  for (const f of FLOORS) {
    const items = await readFloorItems(f);
    const index = items.findIndex((x) => x.id === id);
    if (index >= 0) return { floor: f, index, items, item: items[index] };
  }
  return null;
};

// 목록
router.get('/', async (req, res) => {
  try {
    const { floor, q } = req.query;
    let list = [];

    if (floor) {
      const f = Number(floor);
      if (!FLOORS.includes(f)) return res.status(400).json({ error: 'bad floor' });
      list = (await readFloorItems(f)).map((it) => normalizeItem(it, f, req));
    } else {
      const all = await Promise.all(
        FLOORS.map(async (f) => (await readFloorItems(f)).map((it) => normalizeItem(it, f, req)))
      );
      list = all.flat();
    }

    if (q && String(q).trim() !== '') {
      const qq = String(q).toLowerCase();
      list = list.filter(
        (i) =>
          (i.title || '').toLowerCase().includes(qq) ||
          (i.desc || '').toLowerCase().includes(qq)
      );
    }

    list.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
    res.json({ items: list });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'List failed' });
  }
});

// 상세
router.get('/:id', async (req, res) => {
  try {
    const found = await findItemById(req.params.id);
    if (!found) return res.status(404).json({ error: 'Not found' });
    const { floor, item } = found;
    res.json(normalizeItem(item, floor, req));
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Get failed' });
  }
});

// 등록 (관리자)
router.post('/', authRequired, upload.single('image'), async (req, res) => {
  try {
    const title = (req.body.title || '').trim();
    const desc  = (req.body.desc  || '').trim();
    const floor = Number(req.body.floor);
    if (!title || !FLOORS.includes(floor)) {
      return res.status(400).json({ error: 'title/floor invalid' });
    }

    const newItem = {
      id: genId(),
      title,
      desc,
      floor,
      createdAt: Date.now(),
    };

    // 파일 → dataURL, 아니면 body.image(dataURL), 아니면 imageUrl(절대URL) 허용
    if (req.file && req.file.buffer) {
      newItem.image = toDataURL(req.file);
      delete newItem.imageUrl;
    } else if (req.body.image) {
      newItem.image = String(req.body.image);
      delete newItem.imageUrl;
    } else if (req.body.imageUrl) {
      newItem.imageUrl = String(req.body.imageUrl);
      delete newItem.image;
    } else {
      newItem.image = null;
      delete newItem.imageUrl;
    }

    const items = await readFloorItems(floor);
    items.push(newItem);
    await writeFloorItems(floor, items);

    res.status(201).json({ id: newItem.id });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Create failed' });
  }
});

// 수정 (관리자)
router.put('/:id', authRequired, upload.single('image'), async (req, res) => {
  try {
    const found = await findItemById(req.params.id);
    if (!found) return res.status(404).json({ error: 'Not found' });

    const { floor: curFloor, index, items } = found;
    const updating = { ...items[index] };

    if (req.body.title !== undefined) updating.title = req.body.title;
    if (req.body.desc  !== undefined) updating.desc  = req.body.desc;

    // 이미지 교체: dataURL 우선
    if (req.file && req.file.buffer) {
      updating.image = toDataURL(req.file);
      delete updating.imageUrl;
    } else if (req.body.image) {
      updating.image = String(req.body.image);
      delete updating.imageUrl;
    } else if (req.body.imageUrl) {
      updating.imageUrl = String(req.body.imageUrl);
      delete updating.image;
    }

    const newFloor = req.body.floor !== undefined ? Number(req.body.floor) : curFloor;
    if (!FLOORS.includes(newFloor)) return res.status(400).json({ error: 'bad floor' });

    // 현재 층에서 제거 → 새 층에 추가
    items.splice(index, 1);
    await writeFloorItems(curFloor, items);

    const dstItems = await readFloorItems(newFloor);
    updating.floor = newFloor;
    dstItems.push(updating);
    await writeFloorItems(newFloor, dstItems);

    res.json({ ok: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Update failed' });
  }
});

// 삭제 (관리자)
router.delete('/:id', authRequired, async (req, res) => {
  try {
    const found = await findItemById(req.params.id);
    if (!found) return res.status(404).json({ error: 'Not found' });

    const { floor, index, items } = found;
    items.splice(index, 1);
    await writeFloorItems(floor, items);

    res.json({ ok: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Delete failed' });
  }
});

module.exports = router;