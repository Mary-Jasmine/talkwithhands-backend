import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

import express from 'express';

const router = express.Router();
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '../../..');
const dataDir = path.join(projectRoot, 'backend', 'data');
const alphabetFile = path.join(dataDir, 'alphabet-signs.json');

const defaultAlphabetSigns = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('').map((letter, index) => ({
  id: letter,
  letter,
  title: `Letter ${letter}`,
  image_asset: `assets/images/alphabets/${letter}.png`,
  image_url: '',
  video_asset: '',
  video_url: '',
  description: `ASL hand sign for letter ${letter}.`,
  sort_order: index + 1,
  is_active: true,
}));

async function readAlphabetSigns() {
  try {
    const raw = await fs.readFile(alphabetFile, 'utf8');
    return JSON.parse(raw);
  } catch (err) {
    if (err.code === 'ENOENT') return defaultAlphabetSigns;
    throw err;
  }
}

async function writeAlphabetSigns(signs) {
  await fs.mkdir(dataDir, { recursive: true });
  await fs.writeFile(alphabetFile, JSON.stringify(signs, null, 2));
}

router.get('/', async (_req, res, next) => {
  try {
    const alphabetSigns = await readAlphabetSigns();
    res.json(alphabetSigns.filter((sign) => sign.is_active));
  } catch (err) {
    next(err);
  }
});

router.get('/admin', async (_req, res, next) => {
  try {
    res.json(await readAlphabetSigns());
  } catch (err) {
    next(err);
  }
});

router.post('/', async (req, res, next) => {
  try {
    const alphabetSigns = await readAlphabetSigns();
    const sign = { id: String(Date.now()), is_active: true, ...req.body };
    alphabetSigns.push(sign);
    await writeAlphabetSigns(alphabetSigns);
    res.status(201).json(sign);
  } catch (err) {
    next(err);
  }
});

router.patch('/:id', async (req, res, next) => {
  try {
  const alphabetSigns = await readAlphabetSigns();
  const index = alphabetSigns.findIndex((sign) => sign.id === req.params.id);
  if (index === -1) return res.status(404).json({ message: 'Alphabet sign not found.' });
  alphabetSigns[index] = { ...alphabetSigns[index], ...req.body };
  await writeAlphabetSigns(alphabetSigns);
  res.json(alphabetSigns[index]);
  } catch (err) {
    next(err);
  }
});

router.delete('/:id', async (req, res, next) => {
  try {
  const alphabetSigns = await readAlphabetSigns();
  const index = alphabetSigns.findIndex((sign) => sign.id === req.params.id);
  if (index === -1) return res.status(404).json({ message: 'Alphabet sign not found.' });
  alphabetSigns.splice(index, 1);
  await writeAlphabetSigns(alphabetSigns);
  res.status(204).end();
  } catch (err) {
    next(err);
  }
});

export default router;
