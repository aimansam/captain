import { test } from 'node:test';
import assert from 'node:assert/strict';
import { start } from './helpers.js';

const get = async (t, path) => (await t.call(path)).json;

test('lists containers grouped by project', async () => {
  const t = await start();
  await t.login();
  const list = await get(t, '/api/containers');
  assert.ok(list.length > 10);
  assert.ok(list.some((c) => c.project === 'shop'));
  assert.ok(list.some((c) => c.project === null));
  await t.close();
});

test('stats cover running containers only', async () => {
  const t = await start();
  await t.login();
  const list = await get(t, '/api/containers');
  const stats = await get(t, '/api/stats');
  const running = list.filter((c) => c.state === 'running');
  assert.equal(Object.keys(stats).length, running.length);
  await t.close();
});

test('stop, start and restart a container', async () => {
  const t = await start();
  await t.login();
  const target = (await get(t, '/api/containers')).find((c) => c.name === 'grafana');
  await t.call(`/api/containers/${target.id}/stop`, { method: 'POST' });
  assert.equal((await get(t, '/api/containers')).find((c) => c.id === target.id).state, 'exited');
  await t.call(`/api/containers/${target.id}/start`, { method: 'POST' });
  assert.equal((await get(t, '/api/containers')).find((c) => c.id === target.id).state, 'running');
  assert.equal((await t.call(`/api/containers/${target.id}/restart`, { method: 'POST' })).status, 200);
  await t.close();
});

test('refuses to stop the app itself', async () => {
  const t = await start();
  await t.login();
  const self = (await get(t, '/api/containers')).find((c) => c.self);
  const r = await t.call(`/api/containers/${self.id}/stop`, { method: 'POST' });
  assert.equal(r.status, 403);
  await t.close();
});

test('rejects unknown actions', async () => {
  const t = await start();
  await t.login();
  const any = (await get(t, '/api/containers'))[0];
  assert.equal((await t.call(`/api/containers/${any.id}/explode`, { method: 'POST' })).status, 400);
  await t.close();
});

test('project down then up', async () => {
  const t = await start();
  await t.login();
  const down = await t.call('/api/projects/shop/down', { method: 'POST' });
  assert.equal(down.json.changed, 5);
  const shop = (await get(t, '/api/containers')).filter((c) => c.project === 'shop');
  assert.ok(shop.every((c) => c.state === 'exited'));
  const up = await t.call('/api/projects/shop/up', { method: 'POST' });
  assert.equal(up.json.changed, 5);
  assert.equal((await t.call('/api/projects/missing/down', { method: 'POST' })).status, 404);
  await t.close();
});

test('auto-start toggle updates the restart policy', async () => {
  const t = await start();
  await t.login();
  const c = (await get(t, '/api/containers')).find((x) => x.name === 'sonarr');
  await t.call(`/api/containers/${c.id}/autostart`, { method: 'POST', body: { enabled: false } });
  assert.equal((await get(t, '/api/containers')).find((x) => x.id === c.id).restart, 'no');
  await t.call(`/api/containers/${c.id}/autostart`, { method: 'POST', body: { enabled: true } });
  assert.notEqual((await get(t, '/api/containers')).find((x) => x.id === c.id).restart, 'no');
  await t.close();
});

test('logs return text', async () => {
  const t = await start();
  await t.login();
  const c = (await get(t, '/api/containers'))[0];
  const r = await t.call(`/api/containers/${c.id}/logs?tail=20`);
  assert.equal(r.status, 200);
  assert.ok(r.text.length > 0);
  await t.close();
});

test('cleanup previews stale items and never pre-selects fresh ones as stale', async () => {
  const t = await start();
  await t.login();
  const p = await get(t, '/api/cleanup/preview');
  const old = p.containers.find((c) => c.name === 'old-experiment');
  const fresh = p.containers.find((c) => c.name === 'test-nginx');
  assert.equal(old.stale, true);
  assert.equal(fresh.stale, false);
  assert.ok(p.volumes.length > 0);
  await t.close();
});

test('cleanup removes only what was selected and refuses running containers', async () => {
  const t = await start();
  await t.login();
  const list = await get(t, '/api/containers');
  const stopped = list.find((c) => c.name === 'old-experiment');
  const running = list.find((c) => c.name === 'pihole');
  const r = await t.call('/api/cleanup', {
    method: 'POST',
    body: { containers: [stopped.id, running.id], images: true },
  });
  assert.equal(r.json.removed.containers, 1);
  assert.equal(r.json.removed.images, 5);
  assert.equal(r.json.failed.length, 1);
  const after = await get(t, '/api/containers');
  assert.ok(!after.some((c) => c.id === stopped.id));
  assert.ok(after.some((c) => c.id === running.id));
  assert.ok(after.some((c) => c.name === 'test-nginx'));
  const p = await get(t, '/api/cleanup/preview');
  assert.ok(p.volumes.length > 0, 'volumes untouched when not selected');
  await t.close();
});

test('read-only mode blocks writes but allows reads', async () => {
  const t = await start({ readOnly: true });
  await t.login();
  const list = await t.call('/api/containers');
  assert.equal(list.status, 200);
  const c = list.json[0];
  assert.equal((await t.call(`/api/containers/${c.id}/stop`, { method: 'POST' })).status, 403);
  assert.equal((await t.call('/api/cleanup', { method: 'POST', body: {} })).status, 403);
  assert.equal((await t.call('/api/me')).json.readOnly, true);
  await t.close();
});
