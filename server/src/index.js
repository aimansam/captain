import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { createApp } from './app.js';

const demo = process.env.DEMO === 'true';
const password = process.env.ADMIN_PASSWORD || (demo ? 'demo' : '');

if (!demo && (password.length < 8 || password === 'change-me')) {
  console.error('ADMIN_PASSWORD must be set to at least 8 characters (and not "change-me")');
  process.exit(1);
}

const backend = demo ? await import('./demo.js') : await import('./docker.js');
const here = path.dirname(fileURLToPath(import.meta.url));
const port = Number(process.env.PORT) || 8787;

const app = createApp({
  password,
  secret: process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex'),
  backend,
  demo,
  readOnly: process.env.READ_ONLY === 'true',
  secureCookie: process.env.SECURE_COOKIE === 'true',
  webDir: process.env.WEB_DIR || path.resolve(here, '../../web/dist'),
});

app.listen(port, () =>
  console.log(`captain listening on :${port}${demo ? ' (demo mode)' : ''}${process.env.READ_ONLY === 'true' ? ' (read-only)' : ''}`));
