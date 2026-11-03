import { test } from 'node:test';
import assert from 'node:assert/strict';
import { commandsFor, composeSpec, getJob, startJob, validProjectName } from '../src/rebuild.js';
import { start } from './helpers.js';

const until = async (fn, ms = 5000) => {
  const t = Date.now();
  while (Date.now() - t < ms) {
    const v = await fn();
    if (v) return v;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error('timed out');
};

test('project names are restricted to compose-safe characters', () => {
  for (const ok of ['shop', 'big-bear-crafty', 'graceful_atsushi', 'a1']) assert.ok(validProjectName(ok), ok);
  for (const bad of ['', '../etc', 'a b', 'Shop', '-x', 'a;rm', 'a/b']) assert.ok(!validProjectName(bad), bad);
});

test('composeSpec reads compose labels and rejects unsafe values', () => {
  const labels = {
    'com.docker.compose.project.working_dir': '/srv/shop',
    'com.docker.compose.project.config_files': '/srv/shop/docker-compose.yml,/srv/shop/override.yaml',
  };
  assert.deepEqual(composeSpec(labels), {
    dir: '/srv/shop', files: ['/srv/shop/docker-compose.yml', '/srv/shop/override.yaml'],
  });
  assert.equal(composeSpec({}), null);
  assert.equal(composeSpec({ ...labels, 'com.docker.compose.project.working_dir': 'relative' }), null);
  assert.equal(composeSpec({ ...labels, 'com.docker.compose.project.config_files': '/srv/shop/run.sh' }), null);
});

test('commands pass every value as a separate argument, even with spaces', () => {
  const spec = { dir: '/srv/My App', files: ['/srv/My App/docker-compose.yml'] };
  const [up] = commandsFor('shop', spec);
  assert.deepEqual(up, [
    'compose', '-p', 'shop', '--project-directory', '/srv/My App',
    '-f', '/srv/My App/docker-compose.yml', 'up', '-d', '--build',
  ]);
  const withPull = commandsFor('shop', spec, { pull: true });
  assert.equal(withPull.length, 2);
  assert.ok(withPull[0].includes('pull') && withPull[0].includes('--ignore-buildable'));
});

test('a job captures output and finishes', async () => {
  const { jobId } = startJob('t-ok', [['-e', 'console.log("hello"); console.error("warn")']], { bin: 'node' });
  const job = await until(() => { const j = getJob(jobId); return j.status !== 'running' && j; });
  assert.equal(job.status, 'done');
  assert.equal(job.exitCode, 0);
  assert.match(job.output, /hello/);
  assert.match(job.output, /warn/);
});

test('a failing step marks the job failed and skips later steps', async () => {
  const { jobId } = startJob('t-fail', [['-e', 'process.exit(3)'], ['-e', 'console.log("never")']], { bin: 'node' });
  const job = await until(() => { const j = getJob(jobId); return j.status !== 'running' && j; });
  assert.equal(job.status, 'failed');
  assert.equal(job.exitCode, 3);
  assert.doesNotMatch(job.output, /never/);
});

test('a missing binary fails cleanly', async () => {
  const { jobId } = startJob('t-missing', [['x']], { bin: 'definitely-not-a-binary' });
  const job = await until(() => { const j = getJob(jobId); return j.status !== 'running' && j; });
  assert.equal(job.status, 'failed');
  assert.match(job.output, /failed to start/);
});

test('only one rebuild per project can run at a time', async () => {
  const { jobId } = startJob('t-busy', [['-e', 'setTimeout(()=>{}, 400)']], { bin: 'node' });
  assert.throws(() => startJob('t-busy', [['-e', '1']], { bin: 'node' }), /already running/);
  await until(() => getJob(jobId).status !== 'running');
  assert.ok(startJob('t-busy', [['-e', '1']], { bin: 'node' }).jobId);
});

test('child processes do not inherit Captain secrets', async () => {
  process.env.ADMIN_PASSWORD = 'super-secret-value';
  const { jobId } = startJob('t-env', [['-e', 'console.log("pw=" + process.env.ADMIN_PASSWORD)']], { bin: 'node' });
  const job = await until(() => { const j = getJob(jobId); return j.status !== 'running' && j; });
  assert.match(job.output, /pw=undefined/);
  delete process.env.ADMIN_PASSWORD;
});

test('API: rebuild a project in demo mode', async () => {
  const t = await start();
  await t.login();
  const list = (await t.call('/api/containers')).json;
  assert.ok(list.some((c) => c.project === 'shop' && c.rebuildable));
  assert.ok(list.filter((c) => c.project === 'monitoring').every((c) => !c.rebuildable));

  const r = await t.call('/api/projects/shop/rebuild', { method: 'POST', body: { pull: true } });
  assert.equal(r.status, 200);
  assert.equal((await t.call('/api/projects/shop/rebuild', { method: 'POST', body: {} })).status, 409);
  const job = await until(async () => {
    const j = (await t.call(`/api/jobs/${r.json.jobId}`)).json;
    return j.status === 'done' && j;
  }, 10000);
  assert.match(job.output, /pull/);
  assert.equal((await t.call('/api/jobs/nope')).status, 404);
  assert.equal((await t.call('/api/projects/missing/rebuild', { method: 'POST', body: {} })).status, 404);
  assert.equal((await t.call('/api/projects/monitoring/rebuild', { method: 'POST', body: {} })).status, 409);
  await t.close();
});

test('API: rebuild is blocked in read-only mode and requires login', async () => {
  const ro = await start({ readOnly: true });
  await ro.login();
  assert.equal((await ro.call('/api/projects/shop/rebuild', { method: 'POST', body: {} })).status, 403);
  await ro.close();
  const t = await start();
  assert.equal((await t.call('/api/projects/shop/rebuild', { method: 'POST', body: {}, auth: false })).status, 401);
  await t.close();
});
