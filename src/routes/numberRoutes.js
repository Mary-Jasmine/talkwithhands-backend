import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

import express from 'express';

const router = express.Router();
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dataDir = path.resolve(__dirname, '../../data');
const numberFile = path.join(dataDir, 'number-signs.json');

const defaultNumberSigns = Array.from({ length: 21 }, (_value, number) => ({
  id: String(number),
  number,
  title: `Number ${number}`,
  image_asset: `assets/images/numbers/${number}.png`,
  image_url: '',
  video_asset: '',
  video_url: '',
  description: `ASL hand sign for number ${number}.`,
  sort_order: number,
  is_active: true,
}));

async function readNumberSigns() {
  try {
    const raw = await fs.readFile(numberFile, 'utf8');
    return JSON.parse(raw);
  } catch (err) {
    if (err.code === 'ENOENT') return defaultNumberSigns;
    throw err;
  }
}

async function writeNumberSigns(signs) {
  await fs.mkdir(dataDir, { recursive: true });
  await fs.writeFile(numberFile, JSON.stringify(signs, null, 2));
}

router.get('/', async (_req, res, next) => {
  try {
    const numberSigns = await readNumberSigns();
    res.json(numberSigns.filter((sign) => sign.is_active));
  } catch (err) {
    next(err);
  }
});

router.get('/admin', async (_req, res, next) => {
  try {
    res.json(await readNumberSigns());
  } catch (err) {
    next(err);
  }
});

router.post('/', async (req, res, next) => {
  try {
    const numberSigns = await readNumberSigns();
    const sign = { id: String(Date.now()), is_active: true, ...req.body };
    numberSigns.push(sign);
    await writeNumberSigns(numberSigns);
    res.status(201).json(sign);
  } catch (err) {
    next(err);
  }
});

router.patch('/:id', async (req, res, next) => {
  try {
  const numberSigns = await readNumberSigns();
  const index = numberSigns.findIndex((sign) => sign.id === req.params.id);
  if (index === -1) return res.status(404).json({ message: 'Number sign not found.' });
  numberSigns[index] = { ...numberSigns[index], ...req.body };
  await writeNumberSigns(numberSigns);
  res.json(numberSigns[index]);
  } catch (err) {
    next(err);
  }
});

router.delete('/:id', async (req, res, next) => {
  try {
  const numberSigns = await readNumberSigns();
  const index = numberSigns.findIndex((sign) => sign.id === req.params.id);
  if (index === -1) return res.status(404).json({ message: 'Number sign not found.' });
  numberSigns.splice(index, 1);
  await writeNumberSigns(numberSigns);
  res.status(204).end();
  } catch (err) {
    next(err);
  }
});

export default router;

