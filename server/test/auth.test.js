import { test } from 'node:test';
import assert from 'node:assert/strict';
import { start } from './helpers.js';

test('api requires login', async () => {
  const t = await start();
  assert.equal((await t.call('/api/containers', { auth: false })).status, 401);
  await t.close();
});

test('wrong password is rejected, right one grants access', async () => {
  const t = await start();
  assert.equal((await t.login('nope')).status, 401);
  assert.equal((await t.login()).status, 200);
  assert.equal((await t.call('/api/containers')).status, 200);
  await t.close();
});

test('session cookie is httpOnly and SameSite=Strict', async () => {
  const t = await start();
  const r = await t.login();
  const cookie = r.headers.get('set-cookie');
  assert.match(cookie, /HttpOnly/);
  assert.match(cookie, /SameSite=Strict/);
  await t.close();
});

test('forged or tampered cookie is rejected', async () => {
  const t = await start();
  const forged = `captain_session=${Date.now() + 1e9}.deadbeef`;
  const r = await fetch(`${t.base}/api/containers`, { headers: { Cookie: forged } });
  assert.equal(r.status, 401);
  await t.close();
});

test('login is rate limited after repeated failures', async () => {
  const t = await start();
  let last;
  for (let i = 0; i < 6; i++) last = await t.login('wrong');
  assert.equal(last.status, 429);
  assert.equal((await t.login()).status, 429);
  await t.close();
});

test('logout clears the session', async () => {
  const t = await start();
  await t.login();
  const r = await t.call('/api/logout', { method: 'POST' });
  assert.match(r.headers.get('set-cookie'), /Max-Age=0/);
  await t.close();
});

test('healthz is public', async () => {
  const t = await start();
  const r = await t.call('/healthz', { auth: false });
  assert.deepEqual(r.json, { ok: true });
  await t.close();
});
