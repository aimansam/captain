import { test } from 'node:test';
import assert from 'node:assert/strict';
import { start } from './helpers.js';

const until = async (fn, ms = 8000) => {
  const t = Date.now();
  while (Date.now() - t < ms) {
    const v = await fn();
    if (v) return v;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('timed out');
};

test('security endpoints require login', async () => {
  const t = await start();
  for (const p of ['/api/security/checks', '/api/security/images', '/api/security/status']) {
    assert.equal((await t.call(p, { auth: false })).status, 401, p);
  }
  assert.equal((await t.call('/api/security/scan', { method: 'POST', body: { all: true }, auth: false })).status, 401);
  await t.close();
});

test('checks report findings, accepted risks and daemon info', async () => {
  const t = await start();
  await t.login();
  const r = (await t.call('/api/security/checks')).json;
  assert.ok(r.summary.high >= 1 && r.summary.low >= 1);
  assert.ok(r.checks.length > 5);
  const sock = r.checks.find((c) => c.check === 'docker-sock');
  assert.ok(sock.containers.every((c) => c.ignored), "Captain's own socket mount is accepted");
  const pid = r.checks.find((c) => c.check === 'host-pid');
  assert.equal(pid.open, 0, 'label-accepted finding is not counted');
  assert.equal(r.daemon.seccomp, true);
  const list = (await t.call('/api/containers')).json;
  assert.equal(list.find((c) => c.name === 'shop-postgres').risk, 'high');
  assert.equal(list.find((c) => c.name === 'sonarr').risk, null, 'low-only risk is not badged');
  await t.close();
});

test('images list shows scan state; a scan completes and exposes CVEs', async () => {
  const t = await start();
  await t.login();
  const status = (await t.call('/api/security/status')).json;
  assert.equal(status.available, true);

  const before = (await t.call('/api/security/images')).json;
  const target = before.find((i) => i.status === 'never');
  assert.ok(target, 'demo has an unscanned image');
  assert.equal((await t.call(`/api/security/images/${target.imageId}`)).status, 404);

  const queued = await t.call('/api/security/scan', { method: 'POST', body: { imageId: target.imageId } });
  assert.equal(queued.status, 202);
  assert.equal(queued.json.queued, 1);

  const done = await until(async () => {
    const i = (await t.call('/api/security/images')).json.find((x) => x.imageId === target.imageId);
    return i.status === 'done' && i;
  });
  assert.ok(done.counts.high >= 0 && done.total > 0);
  const detail = (await t.call(`/api/security/images/${target.imageId}`)).json;
  assert.ok(detail.vulns.length > 0);
  assert.ok(['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'].includes(detail.vulns[0].severity));
  await t.close();
});

test('scan input is validated', async () => {
  const t = await start();
  await t.login();
  const post = (body) => t.call('/api/security/scan', { method: 'POST', body });
  assert.equal((await post({ imageId: `sha256:${'f'.repeat(64)}` })).status, 404);
  assert.equal((await t.call('/api/security/images/not-an-id')).status, 404);
  assert.equal((await post({ all: true })).status, 202);
  await t.close();
});

test('read-only mode allows viewing and scanning but still blocks actions', async () => {
  const t = await start({ readOnly: true });
  await t.login();
  assert.equal((await t.call('/api/security/checks')).status, 200);
  assert.equal((await t.call('/api/security/scan', { method: 'POST', body: { all: true } })).status, 202);
  const c = (await t.call('/api/containers')).json[0];
  assert.equal((await t.call(`/api/containers/${c.id}/stop`, { method: 'POST' })).status, 403);
  assert.equal((await t.call('/api/cleanup', { method: 'POST', body: {} })).status, 403);
  await t.close();
});
