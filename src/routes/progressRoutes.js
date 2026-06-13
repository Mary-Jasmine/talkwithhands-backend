import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

import express from 'express';
import jwt from 'jsonwebtoken';
import mongoose from 'mongoose';

import User from '../models/User.js';
import {
  buildProgressResponse,
  normalizeProgress,
  recordProgressActivity,
} from '../lib/progressHelpers.js';

const router = express.Router();
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dataDir = path.resolve(__dirname, '../../data');
const localUsersFile = path.join(dataDir, 'users.json');

function isMongoReady() {
  return process.env.USE_LOCAL_STORE !== 'true' && mongoose.connection.readyState === 1;
}

function jwtSecret() {
  return process.env.JWT_SECRET || 'local-development-secret';
}

async function readLocalUsers() {
  try {
    const raw = await fs.readFile(localUsersFile, 'utf8');
    return JSON.parse(raw);
  } catch (err) {
    if (err.code === 'ENOENT') return [];
    throw err;
  }
}

async function writeLocalUsers(users) {
  await fs.mkdir(dataDir, { recursive: true });
  await fs.writeFile(localUsersFile, JSON.stringify(users, null, 2));
}

async function findUserById(id) {
  if (isMongoReady()) {
    return User.findById(id);
  }
  const users = await readLocalUsers();
  return users.find((user) => user.id === id) || null;
}

async function updateUserProgress(id, progress) {
  if (isMongoReady()) {
    return User.findByIdAndUpdate(
      id,
      { progress, updatedAt: new Date() },
      { new: true }
    );
  }

  const users = await readLocalUsers();
  const index = users.findIndex((user) => user.id === id);
  if (index === -1) return null;
  users[index] = {
    ...users[index],
    progress,
    updatedAt: new Date().toISOString(),
  };
  await writeLocalUsers(users);
  return users[index];
}

async function requireAuth(req, res, next) {
  const header = req.get('authorization') || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ message: 'Missing auth token.' });

  try {
    const payload = jwt.verify(token, jwtSecret());
    const user = await findUserById(payload.sub);
    if (!user) return res.status(401).json({ message: 'Invalid auth token.' });
    req.user = user;
    next();
  } catch {
    res.status(401).json({ message: 'Invalid auth token.' });
  }
}

router.get('/', requireAuth, async (req, res, next) => {
  try {
    const user = req.user;
    if (!user.progress) {
      const progress = normalizeProgress(null);
      const updated = await updateUserProgress(String(user.id || user._id), progress);
      req.user = updated || { ...user, progress };
    }
    res.json(await buildProgressResponse(req.user));
  } catch (err) {
    next(err);
  }
});

router.post('/activity', requireAuth, async (req, res, next) => {
  try {
    const userId = String(req.user.id || req.user._id);
    const progress = recordProgressActivity(req.user, req.body);
    const updated = await updateUserProgress(userId, progress);
    if (!updated) {
      return res.status(404).json({ message: 'User not found.' });
    }
    res.json(await buildProgressResponse(updated));
  } catch (err) {
    if (err.statusCode === 400) {
      return res.status(400).json({ message: err.message });
    }
    next(err);
  }
});

export default router;
