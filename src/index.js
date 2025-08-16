require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');

const authRoutes = require('./routes/auth');
const itemRoutes = require('./routes/items');
const noticeRoutes = require('./routes/notices');

const app = express();

app.use(cors({ origin: true }));               // 개발단계: 모든 도메인 허용
app.use(express.json({ limit: '10mb' }));      // JSON 바디 파서
app.use('/uploads', express.static(path.join(process.cwd(), 'uploads'))); // 업로드 파일 서빙

app.get('/', (_req, res) => res.json({ ok: true, service: 'lostfound-api' }));

app.use('/api/auth', authRoutes);
app.use('/api/items', itemRoutes);
app.use('/api/notices', noticeRoutes);

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => console.log(`API running on http://localhost:${PORT}`));
