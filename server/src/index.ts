import express from 'express';import http from 'http';import cors from 'cors';import helmet from 'helmet';import rateLimit from 'express-rate-limit';import { env } from './config/env';import { createSocketServer } from './socket';import quizRoutes from './routes/quizzes';import gameRoutes from './routes/games';import resultRoutes from './routes/results';import { errorHandler } from './middleware/errorHandler';
const app = express();app.set('trust proxy', 1);app.use(helmet());app.use(cors({ origin: env.CLIENT_ORIGIN.split(','), credentials: true }));app.use(express.json({ limit: '1mb' }));app.use('/api', rateLimit({ windowMs: 60_000, max: 300 }));
app.use(cors({
  origin: env.CLIENT_ORIGIN
    .split(',')
    .map(origin => origin.trim()),
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}));
app.get('/health', (_req, res) => res.json({ ok: true, ts: Date.now() }));
const server = http.createServer(app);export const io = createSocketServer(server);
server.listen(env.PORT, () => console.log(`🚀 API + Socket.IO on :${env.PORT}`));
const shutdown = () => { console.log('shutting down'); io.close(); server.close(() => process.exit(0)); };process.on('SIGTERM', shutdown); process.on('SIGINT', shutdown);
