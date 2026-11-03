import { Router } from 'express';

const wrap = (fn) => (req, res) =>
  Promise.resolve(fn(req, res)).catch((e) => {
    const status = e.status || e.statusCode || 500;
    res.status(status).json({ error: e.message || 'error' });
  });

export function createRoutes(d) {
  const r = Router();

  r.get('/containers', wrap(async (_q, res) => res.json(await d.listContainers())));
  r.get('/stats', wrap(async (_q, res) => res.json(await d.allStats())));
  r.get('/system', wrap(async (_q, res) => res.json(await d.system())));

  r.post('/containers/:id/autostart', wrap(async (req, res) => {
    await d.setAutoStart(req.params.id, req.body?.enabled === true);
    res.json({ ok: true });
  }));

  r.get('/cleanup/preview', wrap(async (_q, res) => res.json(await d.cleanupPreview())));
  r.post('/cleanup', wrap(async (req, res) => res.json(await d.cleanupRun(req.body))));

  r.post('/containers/:id/:action', wrap(async (req, res) => {
    await d.containerAction(req.params.id, req.params.action);
    res.json({ ok: true });
  }));

  r.get('/containers/:id/logs', wrap(async (req, res) => {
    const tail = Math.min(Math.max(parseInt(req.query.tail, 10) || 200, 1), 2000);
    res.type('text/plain').send(await d.logs(req.params.id, tail));
  }));

  r.post('/projects/:name/rebuild', wrap(async (req, res) => {
    res.json(await d.startRebuild(req.params.name, { pull: req.body?.pull === true }));
  }));
  r.get('/jobs/:id', wrap(async (req, res) => res.json(await d.getJob(req.params.id))));

  r.post('/projects/:name/:action', wrap(async (req, res) => {
    res.json(await d.projectAction(req.params.name, req.params.action));
  }));

  return r;
}
