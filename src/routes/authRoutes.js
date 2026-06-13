import crypto from 'crypto';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

import bcrypt from 'bcryptjs';
import express from 'express';
import { OAuth2Client } from 'google-auth-library';
import jwt from 'jsonwebtoken';
import mongoose from 'mongoose';
import multer from 'multer';
import fetch from 'node-fetch';

import User from '../models/User.js';

const router = express.Router();
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dataDir = path.resolve(__dirname, '../../data');
const localUsersFile = path.join(dataDir, 'users.json');
const uploadsDir = path.resolve(__dirname, '../../uploads');
const googleClient = new OAuth2Client();

const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, uploadsDir),
    filename: (_req, file, cb) => {
      const ext = path.extname(file.originalname || '').toLowerCase() || '.jpg';
      cb(null, `${crypto.randomUUID()}${ext}`);
    },
  }),
  limits: { fileSize: 5 * 1024 * 1024 },
});

function isMongoReady() {
  return process.env.USE_LOCAL_STORE !== 'true' && mongoose.connection.readyState === 1;
}

function jwtSecret() {
  return process.env.JWT_SECRET || 'local-development-secret';
}

function normalizeEmail(email) {
  return String(email || '').trim().toLowerCase();
}

function publicUser(user) {
  return {
    id: String(user.id || user._id || ''),
    username: user.username || '',
    email: user.email || '',
    photo_url: user.photo_url || '',
    cover_photo_url: user.cover_photo_url || '',
    stars: Number(user.stars || 0),
    coins: Number(user.coins || 0),
    unlocked_levels: Array.isArray(user.unlocked_levels) ? user.unlocked_levels : [1],
    address: user.address || '',
    contact_number: user.contact_number || '',
    sex: user.sex || '',
    age: user.age ?? null,
    app_feedback: user.app_feedback || { rating: 0, review: '', updated_at: null },
    avatar_preferences: user.avatar_preferences || {
      character: 'hera',
      skin_tone: 'default',
      outfit: 'school',
    },
  };
}

function issueToken(user) {
  return jwt.sign({ sub: String(user.id || user._id), email: user.email }, jwtSecret(), {
    expiresIn: '30d',
  });
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

async function findUserByEmail(email) {
  if (isMongoReady()) {
    return User.findOne({ email });
  }
  const users = await readLocalUsers();
  return users.find((user) => user.email === email) || null;
}

async function findUserById(id) {
  if (isMongoReady()) {
    return User.findById(id);
  }
  const users = await readLocalUsers();
  return users.find((user) => user.id === id) || null;
}

async function createUser(data) {
  if (isMongoReady()) {
    return User.create(data);
  }
  const users = await readLocalUsers();
  const user = {
    id: crypto.randomUUID(),
    photo_url: '',
    cover_photo_url: '',
    stars: 0,
    coins: 0,
    unlocked_levels: [1],
    address: '',
    contact_number: '',
    sex: '',
    age: null,
    app_feedback: { rating: 0, review: '', updated_at: null },
    avatar_preferences: { character: 'hera', skin_tone: 'default', outfit: 'school' },
    progress: {
      learned: { alphabet: [], number: [], basic_word: [] },
      games_played: 0,
      seconds_spent: 0,
      streak_days: 0,
      last_active_date: null,
      monthly_events: {},
    },
    ...data,
    createdAt: new Date().toISOString(),
  };
  users.push(user);
  await writeLocalUsers(users);
  return user;
}

async function findOrCreateProviderUser({ email, username, photoUrl = '' }) {
  const normalizedEmail = normalizeEmail(email);
  if (!normalizedEmail) {
    throw new Error('Provider account did not include an email address.');
  }

  const existing = await findUserByEmail(normalizedEmail);
  if (existing) {
    if (photoUrl && !existing.photo_url) {
      return updateLocalUser(String(existing.id || existing._id), { photo_url: photoUrl });
    }
    return existing;
  }

  const randomPassword = await bcrypt.hash(crypto.randomUUID(), 12);
  return createUser({
    username: username || normalizedEmail.split('@')[0],
    email: normalizedEmail,
    password: randomPassword,
    photo_url: photoUrl,
  });
}

async function updateLocalUser(id, patch) {
  if (isMongoReady()) {
    return User.findByIdAndUpdate(id, patch, { new: true });
  }
  const users = await readLocalUsers();
  const index = users.findIndex((user) => user.id === id);
  if (index === -1) return null;
  users[index] = { ...users[index], ...patch, updatedAt: new Date().toISOString() };
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

router.post('/signup', async (req, res, next) => {
  try {
    const username = String(req.body.username || '').trim();
    const email = normalizeEmail(req.body.email);
    const password = String(req.body.password || '');

    if (!username || !email || password.length < 6) {
      return res.status(400).json({ message: 'Enter a name, email, and password with at least 6 characters.' });
    }
    if (await findUserByEmail(email)) {
      return res.status(409).json({ message: 'Email is already registered.' });
    }

    const hashedPassword = await bcrypt.hash(password, 12);
    const user = await createUser({ username, email, password: hashedPassword });
    res.status(201).json({ token: issueToken(user), user: publicUser(user) });
  } catch (err) {
    next(err);
  }
});

router.post('/login', async (req, res, next) => {
  try {
    const email = normalizeEmail(req.body.email);
    const password = String(req.body.password || '');
    const user = await findUserByEmail(email);
    if (!user || !(await bcrypt.compare(password, user.password))) {
      return res.status(401).json({ message: 'Invalid email or password.' });
    }
    res.json({ token: issueToken(user), user: publicUser(user) });
  } catch (err) {
    next(err);
  }
});

router.post('/logout', (_req, res) => res.json({ ok: true }));

router.get('/me', requireAuth, (req, res) => {
  res.json(publicUser(req.user));
});

router.patch('/settings', requireAuth, async (req, res, next) => {
  try {
    const patch = {
      username: String(req.body.username || '').trim() || req.user.username,
      email: normalizeEmail(req.body.email) || req.user.email,
      address: String(req.body.address || '').trim(),
      contact_number: String(req.body.contact_number || '').trim(),
      sex: String(req.body.sex || '').trim(),
      age: req.body.age === '' || req.body.age == null ? null : Number(req.body.age),
    };
    const user = await updateLocalUser(String(req.user.id || req.user._id), patch);
    res.json(publicUser(user));
  } catch (err) {
    next(err);
  }
});

router.patch('/feedback', requireAuth, async (req, res, next) => {
  try {
    const rating = Math.max(0, Math.min(5, Number(req.body.rating || 0)));
    const app_feedback = {
      rating,
      review: String(req.body.review || '').trim(),
      updated_at: new Date().toISOString(),
    };
    const user = await updateLocalUser(String(req.user.id || req.user._id), { app_feedback });
    res.json(publicUser(user));
  } catch (err) {
    next(err);
  }
});

router.patch('/profile/avatar', requireAuth, async (req, res, next) => {
  try {
    const avatar_preferences = {
      character: String(req.body.character || 'hera').trim(),
      skin_tone: String(req.body.skin_tone || 'default').trim(),
      outfit: String(req.body.outfit || 'school').trim(),
    };
    const user = await updateLocalUser(String(req.user.id || req.user._id), { avatar_preferences });
    res.json(publicUser(user));
  } catch (err) {
    next(err);
  }
});

router.patch('/profile/photo', requireAuth, upload.single('photo'), async (req, res, next) => {
  try {
    const photo_url = req.file ? `/uploads/${req.file.filename}` : req.user.photo_url || '';
    const user = await updateLocalUser(String(req.user.id || req.user._id), { photo_url });
    res.json(publicUser(user));
  } catch (err) {
    next(err);
  }
});

router.patch('/profile/cover-photo', requireAuth, upload.single('photo'), async (req, res, next) => {
  try {
    const cover_photo_url = req.file ? `/uploads/${req.file.filename}` : req.user.cover_photo_url || '';
    const user = await updateLocalUser(String(req.user.id || req.user._id), { cover_photo_url });
    res.json(publicUser(user));
  } catch (err) {
    next(err);
  }
});

router.post('/forgot-password', (_req, res) => {
  res.json({ message: 'If that email exists, a reset code was sent.' });
});

router.post('/reset-password', (_req, res) => {
  res.json({ message: 'Password reset is not configured for the local backend.' });
});

router.post('/google/mobile', async (req, res, next) => {
  try {
    const idToken = String(req.body.idToken || '').trim();
    const clientId = String(process.env.GOOGLE_SERVER_CLIENT_ID || '').trim();

    if (!clientId) {
      return res.status(500).json({ message: 'Missing GOOGLE_SERVER_CLIENT_ID on the backend.' });
    }
    if (!idToken) {
      return res.status(400).json({ message: 'Missing Google idToken.' });
    }

    const ticket = await googleClient.verifyIdToken({
      idToken,
      audience: clientId,
    });
    const payload = ticket.getPayload();
    if (!payload?.email || payload.email_verified !== true) {
      return res.status(401).json({ message: 'Google account email is not verified.' });
    }

    const user = await findOrCreateProviderUser({
      email: payload.email,
      username: payload.name || payload.email.split('@')[0],
      photoUrl: payload.picture || '',
    });

    res.json({ token: issueToken(user), user: publicUser(user) });
  } catch (err) {
    console.error('Google token verification failed:', err?.message || err);
    return res.status(401).json({ message: 'Google token could not be verified.' });
  }
});

router.post('/facebook/mobile', async (req, res, next) => {
  try {
    const accessToken = String(req.body.accessToken || '').trim();
    if (!accessToken) {
      return res.status(400).json({ message: 'Missing Facebook access token.' });
    }

    const profileUrl = new URL('https://graph.facebook.com/v20.0/me');
    profileUrl.searchParams.set('fields', 'id,name,email,picture.type(large)');
    profileUrl.searchParams.set('access_token', accessToken);

    const profileRes = await fetch(profileUrl);
    const profile = await profileRes.json();
    if (!profileRes.ok || profile.error) {
      console.error('Facebook token verification failed:', profile.error || profile);
      return res.status(401).json({ message: 'Facebook token could not be verified.' });
    }

    const email = profile.email || `${profile.id}@facebook.local`;
    const photoUrl = profile.picture?.data?.url || '';
    const user = await findOrCreateProviderUser({
      email,
      username: profile.name || `Facebook User ${profile.id}`,
      photoUrl,
    });

    res.json({ token: issueToken(user), user: publicUser(user) });
  } catch (err) {
    if (err?.type === 'system' || err?.code) {
      return res.status(502).json({ message: 'Could not reach Facebook to verify the token.' });
    }
    next(err);
  }
});

export default router;




