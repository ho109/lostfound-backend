// src/index.js
const path = require('path');
const fs = require('fs');
const express = require('express');
const cors = require('cors');
require('dotenv').config();

const app = express();

// ----- CORS 허용 도메인 -----
const allowedOrigins = (process.env.CORS_ORIGINS
  ? process.env.CORS_ORIGINS.split(',').map(s => s.trim()).filter(Boolean)
  : [
      'http://127.0.0.1:5500',
      'http://localhost:5500',
      'https://ho109.github.io',
    ]);

const corsOptions = {
  origin(origin, cb) {
    if (!origin) return cb(null, true);              // 모바일앱/서버사이드 등 Origin 없는 요청 허용
    if (allowedOrigins.includes(origin)) return cb(null, true);
    if (process.env.CORS_ALLOW_ALL === '1') return cb(null, true);
    return cb(new Error(`CORS blocked: ${origin}`));
  },
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: false, // 쿠키를 쓰지 않으므로 false(쿠키가 필요하면 true)
  optionsSuccessStatus: 204,
};

app.use(cors(corsOptions));
// (선택) 명시적 프리플라이트 핸들링
app.options('*', cors(corsOptions));

app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true }));

// ----- 업로드 정적 서빙 -----
const uploadsDir = path.join(process.cwd(), 'uploads');
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });
app.use('/uploads', express.static(uploadsDir, { maxAge: '30d', immutable: true }));

// ----- 헬스체크 -----
app.get('/', (_req, res) => {
  res.json({ ok: true, service: 'lostfound-api', time: new Date().toISOString() });
});

// ----- 라우트 -----
app.use('/api/auth', require('./routes/auth'));
app.use('/api/items', require('./routes/items'));
app.use('/api/notices', require('./routes/notices'));

// ----- 404 -----
app.use((_req, res) => res.status(404).json({ error: 'Not found' }));

// ----- 에러 핸들러 -----
app.use((err, _req, res, _next) => {
  console.error('[ERROR]', err);
  res.status(500).json({ error: 'Server error', detail: err.message });
});

// ----- 서버 리슨 -----
const PORT = process.env.PORT || 4000;
app.set('trust proxy', 1);
app.listen(PORT, '0.0.0.0', () => {
  console.log(`API running on port ${PORT}`);
  console.log('CORS allowed:', allowedOrigins.join(', ') || '(env CORS_ORIGINS)');
});
