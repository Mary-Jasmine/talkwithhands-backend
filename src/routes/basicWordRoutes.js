import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

import express from 'express';

const router = express.Router();
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dataDir = path.resolve(__dirname, '../data');
const basicWordFile = path.join(dataDir, 'basic-words.json');

async function readBasicWords() {
  try {
    const raw = await fs.readFile(basicWordFile, 'utf8');
    return JSON.parse(raw);
  } catch (err) {
    if (err.code === 'ENOENT') return [];
    throw err;
  }
}

router.get('/', async (_req, res, next) => {
  try {
    const basicWords = await readBasicWords();
    res.json(basicWords.filter((word) => word.is_active !== false));
  } catch (err) {
    next(err);
  }
});

export default router;
