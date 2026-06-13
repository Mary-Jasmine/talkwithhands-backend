import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

import express from 'express';

const router = express.Router();
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dataDir = path.resolve(__dirname, '../../data');
const panoramaFile = path.join(dataDir, 'panorama-scenes.json');

async function readPanoramaScenes() {
  try {
    const raw = await fs.readFile(panoramaFile, 'utf8');
    return JSON.parse(raw);
  } catch (err) {
    if (err.code === 'ENOENT') return [];
    throw err;
  }
}

router.get('/', async (_req, res, next) => {
  try {
    const scenes = await readPanoramaScenes();
    res.json(scenes.filter((scene) => scene.is_active !== false));
  } catch (err) {
    next(err);
  }
});

export default router;

