// Image upload helpers: strict validation, resize + re-encode to small WebP, safe file handling.
// Every upload is fully DECODED and RE-ENCODED, so nothing the user sent (scripts, polyglots,
// metadata) ever reaches disk — only fresh pixels written by us.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const UPLOAD_DIR = process.env.UPLOAD_DIR ? path.resolve(process.env.UPLOAD_DIR) : path.join(HERE, '..', 'uploads');

export const MAX_UPLOAD_BYTES = 3 * 1024 * 1024; // absolute ceiling on the raw request body
const MAX_INPUT_PIXELS = 24_000_000; // stops decompression bombs on a 512 MB box

export const KINDS = {
  avatar: { dir: 'avatars', width: 512, height: 512, fit: 'cover', quality: 80, maxBytes: 3 * 1024 * 1024 },
  squad: { dir: 'squads', width: 1280, height: 1280, fit: 'inside', quality: 78, maxBytes: 1.5 * 1024 * 1024 },
};
const FILE_RE = /^[0-9]+-[a-f0-9]{16}\.webp$/;

export function ensureUploadDirs() {
  for (const k of Object.values(KINDS)) fs.mkdirSync(path.join(UPLOAD_DIR, k.dir), { recursive: true });
}

const err = (status, message) => Object.assign(new Error(message), { status });

/* Magic-byte sniffing: the declared Content-Type / file extension is never trusted. */
export function sniff(buf) {
  if (buf.length < 12) return null;
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'jpeg';
  if (buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'png';
  if (buf.subarray(0, 4).toString('latin1') === 'RIFF' && buf.subarray(8, 12).toString('latin1') === 'WEBP') return 'webp';
  return null;
}

export function readBody(req, limit = MAX_UPLOAD_BYTES) {
  const mb = Math.round((limit / (1024 * 1024)) * 10) / 10;
  return new Promise((resolve, reject) => {
    const declared = Number(req.headers['content-length']);
    if (declared > limit) { req.resume(); return reject(err(413, `Image is too large (max ${mb} MB)`)); }
    const chunks = [];
    let size = 0, failed = false;
    req.on('data', (c) => {
      if (failed) return;
      size += c.length;
      if (size > limit) { failed = true; chunks.length = 0; reject(err(413, `Image is too large (max ${mb} MB)`)); return; }
      chunks.push(c);
    });
    req.on('end', () => { if (!failed) resolve(Buffer.concat(chunks)); });
    req.on('error', (e) => { if (!failed) reject(e); });
  });
}

let sharpMod = null;
async function getSharp() {
  if (sharpMod) return sharpMod;
  try {
    sharpMod = (await import('sharp')).default;
  } catch {
    throw err(503, 'Image processing is not installed on the server (run: npm install)');
  }
  sharpMod.cache(false);       // don't keep decoded images in RAM
  sharpMod.concurrency(1);     // 1 vCPU
  return sharpMod;
}

/* Only one image is processed at a time — protects the 512 MB box from parallel decodes. */
let chain = Promise.resolve();
const serial = (fn) => { const p = chain.then(fn, fn); chain = p.catch(() => {}); return p; };

export function processImage(buf, kindName) {
  const kind = KINDS[kindName];
  return serial(async () => {
    if (!sniff(buf)) throw err(400, 'Unsupported file. Use a JPG, PNG or WebP image.');
    const sharp = await getSharp();
    let meta;
    try {
      meta = await sharp(buf, { limitInputPixels: MAX_INPUT_PIXELS }).metadata();
    } catch {
      throw err(400, 'That file is not a valid image (or its resolution is too large).');
    }
    if (!['jpeg', 'png', 'webp'].includes(meta.format)) throw err(400, 'Unsupported file. Use a JPG, PNG or WebP image.');
    const encode = (quality) =>
      sharp(buf, { limitInputPixels: MAX_INPUT_PIXELS, failOn: 'error' })
        .rotate() // honour phone EXIF orientation, then metadata is dropped on output
        .resize({ width: kind.width, height: kind.height, fit: kind.fit, position: 'centre', withoutEnlargement: kind.fit === 'inside' })
        .webp({ quality, effort: 4 })
        .toBuffer();
    try {
      let out = await encode(kind.quality);
      if (out.length > 400 * 1024) out = await encode(60);
      return out;
    } catch {
      throw err(400, 'That image could not be processed. Try a different one.');
    }
  });
}

export function saveImage(buf, kindName, playerId) {
  const dir = path.join(UPLOAD_DIR, KINDS[kindName].dir);
  fs.mkdirSync(dir, { recursive: true });
  const file = `${Number(playerId)}-${crypto.randomBytes(8).toString('hex')}.webp`; // unique → also busts caches
  const tmp = path.join(dir, `.${file}.tmp`);
  fs.writeFileSync(tmp, buf, { mode: 0o644 });
  fs.renameSync(tmp, path.join(dir, file));
  return file;
}

export function removeImage(kindName, file) {
  if (!file || !FILE_RE.test(file)) return; // never touch anything that isn't one of our generated names
  try { fs.unlinkSync(path.join(UPLOAD_DIR, KINDS[kindName].dir, file)); } catch { /* already gone */ }
}

/* tiny in-memory limiter: max 20 uploads per user per hour */
const hits = new Map();
export function uploadAllowed(userId) {
  const now = Date.now();
  const list = (hits.get(userId) || []).filter((t) => now - t < 3600_000);
  if (list.length >= 20) { hits.set(userId, list); return false; }
  list.push(now); hits.set(userId, list);
  return true;
}
