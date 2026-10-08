// Robinhood Tournament of Champions — VPS server
// Runs the existing api/**/*.js handlers (written for Vercel) unchanged,
// serves the frontend from /public, and sits behind nginx.
import 'dotenv/config';
import express from 'express';
import rateLimit from 'express-rate-limit';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const API_DIR = path.join(__dirname, 'api');
const PUBLIC_DIR = path.join(__dirname, 'public');
const PORT = Number(process.env.PORT) || 3000;
const HOST = process.env.HOST || '127.0.0.1';

/* ── Fail fast on bad config (clear message instead of a mystery 500 later) ── */
const missing = ['DATABASE_URL', 'JWT_SECRET'].filter((k) => !process.env[k]);
if (missing.length) {
  console.error(`[startup] Missing required env var(s): ${missing.join(', ')}. Copy .env.example to .env and fill it in.`);
  process.exit(1);
}
if (process.env.JWT_SECRET.length < 32) {
  console.error('[startup] JWT_SECRET must be at least 32 characters. Generate one with: openssl rand -hex 32');
  process.exit(1);
}
if (!process.env.ADMIN_REGISTRATION_CODE) {
  console.warn('[startup] ADMIN_REGISTRATION_CODE is not set: nobody can register as admin (existing admins can still log in).');
}

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', 1); // nginx is the single proxy in front; makes req.ip the real client

/* ── Run migrations ── */
try {
  const { runMigrations } = await import(pathToFileURL(path.join(API_DIR, '_migrate.js')).href);
  await runMigrations();
} catch (e) {
  console.error('[startup] Migration failed:', e.message);
  process.exit(1);
}

/* ── Ensure upload directories ── */
try {
  const { ensureUploadDirs } = await import(pathToFileURL(path.join(API_DIR, '_images.js')).href);
  ensureUploadDirs();
} catch (e) {
  console.error('[startup] Could not prepare upload dirs:', e.message);
}

/* ── Basic hardening headers ── */
app.use((_req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'same-origin');
  next();
});

/* ── Body parsing (Vercel did this automatically) ── */
app.use(express.json({ limit: '100kb' }));
app.use((req, _res, next) => {
  if (req.body === undefined) req.body = {};
  next();
});

/* ── Health check (no DB) ── */
app.get('/healthz', (_req, res) => res.json({ ok: true }));

/* ── Brute-force protection: only FAILED login/register attempts count ── */
app.use(
  '/api/auth',
  rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 20,
    skipSuccessfulRequests: true,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    message: { error: 'Too many failed attempts. Try again in a few minutes.' },
  })
);

/* ── Auto-mount every .js file under api/ as a route (same URLs as on Vercel) ──
   api/auth/login.js   -> /api/auth/login
   api/cycles/index.js -> /api/cycles
   Files starting with "_" (helpers) are skipped. */
function collectHandlers(dir, base = '') {
  const found = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith('_') || entry.name.startsWith('.')) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      found.push(...collectHandlers(full, `${base}/${entry.name}`));
    } else if (entry.name.endsWith('.js')) {
      const name = entry.name.slice(0, -3);
      found.push({ file: full, route: name === 'index' ? base || '/' : `${base}/${name}` });
    }
  }
  return found;
}

for (const { file, route } of collectHandlers(API_DIR)) {
  const mod = await import(pathToFileURL(file).href);
  if (typeof mod.default !== 'function') {
    console.warn(`[api] ${path.relative(__dirname, file)} has no default export, skipped`);
    continue;
  }
  app.all(`/api${route}`, async (req, res) => {
    try {
      await mod.default(req, res);
    } catch (err) {
      console.error(`[api] ${req.method} ${req.originalUrl}`, err);
      if (!res.headersSent) res.status(500).json({ error: 'Server error' });
    }
  });
  console.log(`[api] mounted /api${route}`);
}

app.use('/api', (_req, res) => res.status(404).json({ error: 'Not found' }));

/* ── Static files for uploads ── */
app.use('/uploads', express.static(path.join(__dirname, 'uploads'), { index: false }));

/* ── Frontend ── */
app.use(
  express.static(PUBLIC_DIR, {
    index: false,
    setHeaders(res, filePath) {
      if (filePath.endsWith('.html')) res.setHeader('Cache-Control', 'no-cache');
    },
  })
);
app.get('*', (_req, res) => {
  res.setHeader('Cache-Control', 'no-cache');
  res.sendFile(path.join(PUBLIC_DIR, 'index.html'));
});

/* ── Error handler (bad JSON etc.) ── */
app.use((err, _req, res, _next) => {
  if (err?.type === 'entity.parse.failed') return res.status(400).json({ error: 'Invalid JSON' });
  console.error('[error]', err);
  if (!res.headersSent) res.status(500).json({ error: 'Server error' });
});

const server = app.listen(PORT, HOST, () => {
  console.log(`[server] listening on http://${HOST}:${PORT}`);
});

for (const sig of ['SIGTERM', 'SIGINT']) {
  process.on(sig, () => {
    console.log(`[server] ${sig} received, shutting down`);
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(1), 10_000).unref();
  });
}
process.on('unhandledRejection', (e) => console.error('[unhandledRejection]', e));
