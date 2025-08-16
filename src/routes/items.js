const express = require('express');
const { db } = require('../config/firebase');
const { authRequired } = require('../middleware/auth');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

const router = express.Router();

// ---- 설정 ------------------------------------------------------------
const FLOORS = [1, 2, 3, 4];
const colName = 'lostItems';                 // ✅ 기존 파이어베이스 컬렉션명
const docId = (f) => `floor${f}`;

// 업로드 폴더 보장
const UPLOAD_DIR = path.join(process.cwd(), 'uploads');
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, UPLOAD_DIR),
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname);
    cb(null, Date.now() + '-' + Math.random().toString(36).slice(2) + ext);
  },
});
const upload = multer({ storage });

// ---- 유틸 ------------------------------------------------------------
function genId() {
  return String(Date.now()) + Math.random().toString(36).slice(2, 7);
}
function normalizeItem(it, floor) {
  // 기존 문서엔 image(base64)일 수도, imageUrl일 수도 있음
  const imageUrl = it.imageUrl || it.image || null;
  return { ...it, floor, imageUrl };
}
async function getFloorItems(floor) {
  const snap = await db.collection(colName).doc(docId(floor)).get();
  const arr = snap.exists ? (snap.data().items || []) : [];
  return arr.map((it) => normalizeItem(it, floor));
}
async function findItemById(id) {
  for (const f of FLOORS) {
    const snap = await db.collection(colName).doc(docId(f)).get();
    if (!snap.exists) continue;
    const arr = snap.data().items || [];
    const idx = arr.findIndex((x) => x.id === id);
    if (idx >= 0) return { floor: f, index: idx, item: arr[idx], items: arr };
  }
  return null;
}

// ---- 목록 ------------------------------------------------------------
/** GET /api/items?floor=1&q=키워드  */
router.get('/', async (req, res) => {
  try {
    const { floor, q } = req.query;
    let list = [];

    if (floor) {
      const f = Number(floor);
      if (!FLOORS.includes(f)) return res.status(400).json({ error: 'bad floor' });
      list = await getFloorItems(f);
    } else {
      // 전체
      const all = await Promise.all(FLOORS.map((f) => getFloorItems(f)));
      list = all.flat();
    }

    if (q && String(q).trim() !== '') {
      const query = String(q).toLowerCase();
      list = list.filter(
        (i) =>
          (i.title || '').toLowerCase().includes(query) ||
          (i.desc || '').toLowerCase().includes(query)
      );
    }

    list.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
    res.json({ items: list });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'List failed' });
  }
});

// ---- 상세 ------------------------------------------------------------
/** GET /api/items/:id */
router.get('/:id', async (req, res) => {
  try {
    const found = await findItemById(req.params.id);
    if (!found) return res.status(404).json({ error: 'Not found' });
    const { floor, item } = found;
    return res.json(normalizeItem(item, floor));
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Get failed' });
  }
});

// ---- 등록 ------------------------------------------------------------
/** POST /api/items  (관리자) - multipart(form-data) 또는 JSON */
router.post('/', authRequired, upload.single('image'), async (req, res) => {
  try {
    const title = (req.body.title || '').trim();
    const desc = (req.body.desc || '').trim();
    const floor = Number(req.body.floor);
    if (!title || !FLOORS.includes(floor)) {
      return res.status(400).json({ error: 'title/floor invalid' });
    }

    const newItem = {
      id: genId(),
      title,
      desc,
      floor,               // 보조적으로 저장(문서에도 있지만 유지)
      createdAt: Date.now(),
    };

    // 이미지 처리: 파일 → imageUrl, 없으면 그대로(null)
    if (req.file) {
      newItem.imageUrl = `/uploads/${req.file.filename}`;
    } else if (req.body.image) {
      // 혹시 프런트에서 base64(dataURL)로 줄 경우 호환
      newItem.image = req.body.image;
    } else {
      newItem.imageUrl = null;
    }

    const ref = db.collection(colName).doc(docId(floor));
    const snap = await ref.get();
    const items = snap.exists ? (snap.data().items || []) : [];
    items.push(newItem);
    await ref.set({ items });

    res.status(201).json({ id: newItem.id });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Create failed' });
  }
});

// ---- 수정 ------------------------------------------------------------
/** PUT /api/items/:id  (관리자) - multipart(form-data 또는 JSON)
 *  floor가 바뀌면 해당 층 문서로 "이동"
 */
router.put('/:id', authRequired, upload.single('image'), async (req, res) => {
  try {
    const found = await findItemById(req.params.id);
    if (!found) return res.status(404).json({ error: 'Not found' });

    const { floor: curFloor, index, items } = found;
    const updating = { ...items[index] };

    if (req.body.title !== undefined) updating.title = req.body.title;
    if (req.body.desc !== undefined) updating.desc = req.body.desc;
    // 이미지 교체
    if (req.file) {
      updating.imageUrl = `/uploads/${req.file.filename}`;
      delete updating.image; // 기존 base64 필드는 제거
    }
    // 층 이동 여부
    const newFloor =
      req.body.floor !== undefined ? Number(req.body.floor) : curFloor;
    if (!FLOORS.includes(newFloor)) return res.status(400).json({ error: 'bad floor' });

    // 현재 층에서 제거
    items.splice(index, 1);
    await db.collection(colName).doc(docId(curFloor)).set({ items });

    // 목적 층에 추가(또는 수정)
    const dstRef = db.collection(colName).doc(docId(newFloor));
    const dstSnap = await dstRef.get();
    const dstItems = dstSnap.exists ? (dstSnap.data().items || []) : [];
    updating.floor = newFloor;
    dstItems.push(updating);
    await dstRef.set({ items: dstItems });

    res.json({ ok: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Update failed' });
  }
});

// ---- 삭제 ------------------------------------------------------------
/** DELETE /api/items/:id  (관리자) */
router.delete('/:id', authRequired, async (req, res) => {
  try {
    const found = await findItemById(req.params.id);
    if (!found) return res.status(404).json({ error: 'Not found' });

    const { floor, index, items } = found;
    items.splice(index, 1);
    await db.collection(colName).doc(docId(floor)).set({ items });
    res.json({ ok: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Delete failed' });
  }
});

module.exports = router;
