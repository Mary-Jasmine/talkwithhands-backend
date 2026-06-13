import path from 'path';
import { fileURLToPath } from 'url';
import dns from 'dns';
import fs from 'fs';

import dotenv from 'dotenv';
import express from 'express';
import mongoose from 'mongoose';
import helmet from 'helmet';
import cors from 'cors';
import cookieParser from 'cookie-parser';

import authRoutes from './routes/authRoutes.js';
import alphabetRoutes from './routes/alphabetRoutes.js';
import basicWordRoutes from './routes/basicWordRoutes.js';
import numberRoutes from './routes/numberRoutes.js';
import panoramaRoutes from './routes/panoramaRoutes.js';
import progressRoutes from './routes/progressRoutes.js';
import mediaRoutes from './routes/mediaRoutes.js';
import uploadRoutes from './routes/uploadRoutes.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '..');
const assetsDir = path.resolve(__dirname, '../assets');
const uploadsDir = path.resolve(__dirname, '../uploads');
console.log('Serving assets from:', assetsDir);
console.log('Assets dir exists:', fs.existsSync(assetsDir));

dotenv.config({ path: path.resolve(__dirname, '../.env') });

function hasUnsafeKey(value) {
  if (!value || typeof value !== 'object') return false;
  if (Array.isArray(value)) return value.some(hasUnsafeKey);
  return Object.entries(value).some(([key, nested]) => {
    return key.startsWith('$') || key.includes('.') || hasUnsafeKey(nested);
  });
}

export function createApp(options = {}) {
  const app = express();

  app.set('trust proxy', 1);
  app.use(helmet());
  app.use(express.json({ limit: '200kb' }));
  app.use(cookieParser());

  const allowedOrigins = (process.env.CORS_ORIGINS || '')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);

  app.use(
    cors({
      origin(origin, callback) {
        if (!origin || allowedOrigins.length === 0 || allowedOrigins.includes(origin)) {
          return callback(null, true);
        }
        return callback(new Error('Origin not allowed by CORS'));
      },
      credentials: true,
    })
  );

  app.use((req, res, next) => {
    if (hasUnsafeKey(req.body)) {
      return res.status(400).json({ message: 'Invalid request payload.' });
    }
    next();
  });

  if (options.beforeRoutes) {
    app.use(options.beforeRoutes);
  }

  app.get('/health', (_req, res) => res.json({ ok: true }));

  app.use(
    '/assets',
    express.static(assetsDir, {
      acceptRanges: true,
      setHeaders(res) {
        res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Cache-Control', 'public, max-age=86400');
      },
    })
  );
  app.use(
    '/uploads',
    express.static(uploadsDir, {
      acceptRanges: true,
      setHeaders(res) {
        res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Cache-Control', 'public, max-age=86400');
      },
    })
  );

  app.use('/auth', authRoutes);
  app.use('/media', mediaRoutes);
  app.use('/progress', progressRoutes);
  app.use('/admin/uploads', uploadRoutes);
  app.use('/alphabet-signs', alphabetRoutes);
  app.use('/basic-words', basicWordRoutes);
  app.use('/number-signs', numberRoutes);
  app.use('/panorama-scenes', panoramaRoutes);

  app.use((err, _req, res, _next) => {
    console.error(err);
    res.status(500).json({ message: 'Server error.' });
  });

  return app;
}

let mongoConnectionPromise;

export async function connectDb() {
  if ((process.env.USE_LOCAL_STORE || '').toLowerCase() === 'true') {
    console.log('Using local JSON store; skipping MongoDB connection.');
    return null;
  }

  if (!process.env.MONGO_URI) {
    console.log('Missing MONGO_URI; using local JSON store.');
    process.env.USE_LOCAL_STORE = 'true';
    return null;
  }
  if (!process.env.JWT_SECRET) {
    console.log('Missing JWT_SECRET; using local development secret.');
    process.env.JWT_SECRET = 'local-development-secret';
  }

  if (mongoose.connection.readyState === 1) return mongoose.connection;
  if (mongoConnectionPromise) return mongoConnectionPromise;

  const mongoUri = process.env.MONGO_URI;
  if (mongoUri.startsWith('mongodb+srv://')) {
    const dnsServers = (process.env.MONGO_DNS_SERVERS || '8.8.8.8,1.1.1.1')
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean);
    if (dnsServers.length > 0) {
      dns.setServers(dnsServers);
    }
  }

  mongoConnectionPromise = mongoose.connect(mongoUri);
  return mongoConnectionPromise;
}

export async function start() {
  await connectDb();

  const app = createApp();
  const port = Number(process.env.PORT || process.env.RAILWAY_PORT || 8080);
  const host = process.env.HOST || '0.0.0.0';
  app.listen(port, host, () => {
    console.log(`Auth API running on http://${host}:${port}`);
  });
}
