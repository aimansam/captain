import path from 'node:path';
import express from 'express';
import { createAuth } from './auth.js';
import { createRoutes } from './routes.js';

export function createApp({ password, secret, backend, demo = false, readOnly = false, webDir, secureCookie = false }) {
  const auth = createAuth({ password, secret, secureCookie });
  const app = express();

  app.disable('x-powered-by');
  app.use(express.json({ limit: '10kb' }));

  app.get('/healthz', (_req, res) => res.json({ ok: true }));
  app.post('/api/login', auth.login);
  app.post('/api/logout', auth.logout);
  app.get('/api/me', (req, res) => res.json({ authed: auth.isAuthed(req), demo, readOnly }));

  const blockWrites = (req, res, next) =>
    readOnly && req.method !== 'GET'
      ? res.status(403).json({ error: 'read-only mode' })
      : next();

  app.use('/api', auth.requireAuth, blockWrites, createRoutes(backend));

  if (webDir) {
    app.use(express.static(webDir));
    app.get('*', (_req, res) => res.sendFile(path.join(webDir, 'index.html')));
  }
  return app;
}
