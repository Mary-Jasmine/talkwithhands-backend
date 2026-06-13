import fs from 'fs';
import fsp from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { Transform } from 'stream';
import { pipeline } from 'stream/promises';

import express from 'express';
import fetch from 'node-fetch';

const router = express.Router();
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '../../..');
const videoCacheDir = path.join(projectRoot, 'uploads', 'video-cache');

fs.mkdirSync(videoCacheDir, { recursive: true });

const inflight = new Map();

function cachePath(fileId) {
  const safeId = String(fileId || '').replace(/[^a-zA-Z0-9_-]/g, '');
  if (!safeId) return null;
  return path.join(videoCacheDir, `${safeId}.mp4`);
}

function driveDownloadUrl(fileId) {
  return `https://drive.usercontent.google.com/download?id=${encodeURIComponent(fileId)}&export=download&confirm=t`;
}

function setVideoHeaders(res, contentType, contentLength) {
  res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Accept-Ranges', 'bytes');
  res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
  if (contentType) {
    res.setHeader('Content-Type', contentType);
  }
  if (contentLength) {
    res.setHeader('Content-Length', contentLength);
  }
}

async function downloadToCache(fileId, dest) {
  if (inflight.has(fileId)) {
    await inflight.get(fileId);
    return;
  }

  const tmp = `${dest}.partial`;
  const task = (async () => {
    const response = await fetch(driveDownloadUrl(fileId), { redirect: 'follow' });
    if (!response.ok) {
      throw new Error(`Google Drive download failed (${response.status}).`);
    }
    await pipeline(response.body, fs.createWriteStream(tmp));
    await fsp.rename(tmp, dest);
  })();

  inflight.set(fileId, task);
  try {
    await task;
  } catch (error) {
    await fsp.rm(tmp, { force: true });
    throw error;
  } finally {
    inflight.delete(fileId);
  }
}

router.get('/videos/:fileId', async (req, res, next) => {
  try {
    const fileId = String(req.params.fileId || '').trim();
    const dest = cachePath(fileId);
    if (!dest) {
      return res.status(400).json({ message: 'Invalid video id.' });
    }

    if (fs.existsSync(dest)) {
      setVideoHeaders(res, 'video/mp4');
      return res.sendFile(dest);
    }

    const response = await fetch(driveDownloadUrl(fileId), { redirect: 'follow' });
    if (!response.ok) {
      return res.status(502).json({ message: 'Could not fetch video from Google Drive.' });
    }

    const contentType = response.headers.get('content-type') || 'video/mp4';
    const contentLength = response.headers.get('content-length');
    setVideoHeaders(res, contentType, contentLength);

    const tmp = `${dest}.partial`;
    const writeStream = fs.createWriteStream(tmp);
    let finished = false;

    const tee = new Transform({
      transform(chunk, _encoding, callback) {
        writeStream.write(chunk);
        callback(null, chunk);
      },
      flush(callback) {
        writeStream.end(() => {
          finished = true;
          fsp.rename(tmp, dest).finally(() => callback());
        });
      },
    });

    response.body.on('error', async (error) => {
      writeStream.destroy();
      await fsp.rm(tmp, { force: true });
      if (!res.headersSent) {
        next(error);
      } else {
        res.destroy();
      }
    });

    res.on('close', async () => {
      if (!finished) {
        writeStream.destroy();
        await fsp.rm(tmp, { force: true });
      }
    });

    await pipeline(response.body, tee, res);
  } catch (error) {
    next(error);
  }
});

export default router;
