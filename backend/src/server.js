import express from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import { authRequired } from './auth.js';
import authRoutes from './routes/auth.js';
import petRoutes from './routes/pets.js';
import resourceRoutes from './routes/resources.js';
import caseRoutes from './routes/cases.js';
import staffRoutes from './routes/staff.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
app.use(cors());
app.use(express.json({ limit: '6mb' }));

app.get('/api/health', (_req, res) => res.json({ ok: true, ts: Date.now() }));
app.use('/api/auth', authRoutes);
app.use('/api', authRequired, petRoutes);
app.use('/api', authRequired, resourceRoutes);
app.use('/api', authRequired, caseRoutes);
app.use('/api', authRequired, staffRoutes);

app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(err.status || 500).json({ error: err.message || '服务器内部错误' });
});

// 前端静态资源（同镜像部署）
const dist = path.resolve(__dirname, '../frontend/dist');
app.use(express.static(dist));
app.get(/^(?!\/api).*/, (_req, res) => res.sendFile(path.join(dist, 'index.html')));

const port = Number(process.env.PORT || 3000);
app.listen(port, () => console.log(`Pet hospital server listening on ${port}`));
