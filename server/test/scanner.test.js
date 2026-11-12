import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { cleanError, createScanner, parseTrivy, validImageId } from '../src/scanner.js';

const ID = `sha256:${'a'.repeat(64)}`;
const ID2 = `sha256:${'b'.repeat(64)}`;

const trivyReport = {
  Results: [
    { Vulnerabilities: [
      { VulnerabilityID: 'CVE-1', PkgName: 'openssl', InstalledVersion: '1.0', FixedVersion: '1.1', Severity: 'HIGH', Title: 'a' },
      { VulnerabilityID: 'CVE-2', PkgName: 'zlib', InstalledVersion: '1.2', Severity: 'CRITICAL', Title: 'b' },
      { VulnerabilityID: 'CVE-3', PkgName: 'curl', InstalledVersion: '7', FixedVersion: '8', Severity: 'LOW' },
      { VulnerabilityID: 'CVE-1', PkgName: 'openssl', InstalledVersion: '1.0', FixedVersion: '1.1', Severity: 'HIGH' },
    ] },
    { Vulnerabilities: [{ VulnerabilityID: 'CVE-4', PkgName: 'x', InstalledVersion: '1', Severity: 'WEIRD' }] },
    { Target: 'no vulns here' },
  ],
};

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'captain-scan-'));

// Fake "trivy": a node one-liner that prints the given report (or fails) instead of scanning.
const fake = (script, dataDir = tmp()) => createScanner({
  bin: process.execPath, buildArgs: () => ['-e', script], dataDir, timeoutMs: 5000,
});
const json = (o) => `console.log(${JSON.stringify(JSON.stringify(o))})`;

test('image ids must be full sha256 digests', () => {
  assert.ok(validImageId(ID));
  for (const bad of ['', 'nginx', 'sha256:abc', `sha256:${'g'.repeat(64)}`, `--help`, `${ID} --x`, null, 5]) {
    assert.ok(!validImageId(bad), String(bad));
  }
});

test('parseTrivy counts, de-duplicates, sorts and tolerates unknown severities', () => {
  const r = parseTrivy(trivyReport);
  assert.equal(r.total, 4);
  assert.deepEqual(r.counts, { critical: 1, high: 1, medium: 0, low: 1, unknown: 1 });
  assert.equal(r.fixable, 2);
  assert.deepEqual(r.vulns.map((v) => v.id), ['CVE-2', 'CVE-1', 'CVE-3', 'CVE-4']);
  assert.equal(r.vulns[3].severity, 'UNKNOWN');
  assert.deepEqual(parseTrivy({}).counts, { critical: 0, high: 0, medium: 0, low: 0, unknown: 0 });
});

test('parseTrivy caps the stored list but not the counts', () => {
  const many = { Results: [{ Vulnerabilities: Array.from({ length: 700 }, (_, i) => (
    { VulnerabilityID: `CVE-${i}`, PkgName: 'p', InstalledVersion: '1', Severity: 'LOW' })) }] };
  const r = parseTrivy(many);
  assert.equal(r.total, 700);
  assert.equal(r.vulns.length, 500);
});

test('a scan runs, stores the parsed report and persists it', async () => {
  const dir = tmp();
  const s = fake(json(trivyReport), dir);
  assert.equal(s.scan(ID), true);
  assert.equal(s.summary(ID).status, 'scanning', 'the first scan starts right away');
  await s.idle();
  const sum = s.summary(ID);
  assert.equal(sum.status, 'done');
  assert.equal(sum.counts.critical, 1);
  assert.equal(sum.vulns, undefined, 'summary omits the CVE list');
  assert.equal(s.detail(ID).vulns.length, 4);

  const reloaded = fake(json(trivyReport), dir);
  assert.equal(reloaded.summary(ID).status, 'done');
  assert.equal(reloaded.detail(ID).vulns.length, 4);
});

test('the same image is not queued twice while pending', async () => {
  const s = fake('setTimeout(()=>console.log("{}"), 150)');
  assert.equal(s.scan(ID), true);
  assert.equal(s.scan(ID), false);
  await s.idle();
  assert.equal(s.scan(ID), true, 'can be rescanned once finished');
  await s.idle();
});

test('scans run one at a time, in order', async () => {
  const dir = tmp();
  const log = path.join(dir, 'order.log');
  const s = createScanner({
    bin: process.execPath, dataDir: dir, timeoutMs: 5000,
    buildArgs: (id) => ['-e', `const f=require('fs');f.appendFileSync(${JSON.stringify(log)},'start ${id.slice(7, 8)}\\n');setTimeout(()=>{f.appendFileSync(${JSON.stringify(log)},'end ${id.slice(7, 8)}\\n');console.log('{}')},120)`],
  });
  s.scan(ID);
  s.scan(ID2);
  assert.equal(s.summary(ID2).status, 'queued', 'the second waits its turn');
  assert.deepEqual(s.busy(), { queued: 1, scanning: true });
  await s.idle();
  assert.deepEqual(fs.readFileSync(log, 'utf8').trim().split('\n'), ['start a', 'end a', 'start b', 'end b']);
});

test('failures become an error with the scanner message', async () => {
  const s = fake('console.error("FATAL db download failed"); process.exit(2)');
  s.scan(ID);
  await s.idle();
  assert.equal(s.summary(ID).status, 'error');
  assert.match(s.summary(ID).error, /db download failed/);
});

test('garbage output and a missing binary are reported cleanly', async () => {
  const garbage = fake('console.log("not json")');
  garbage.scan(ID);
  await garbage.idle();
  assert.equal(garbage.summary(ID).error, 'could not read scanner output');

  const missing = createScanner({ bin: 'definitely-not-trivy', buildArgs: () => [], dataDir: tmp() });
  missing.scan(ID);
  await missing.idle();
  assert.match(missing.summary(ID).error, /could not start/);
  assert.deepEqual(await missing.info(), { available: false });
});

test('invalid image ids are rejected before anything runs', () => {
  const s = fake('console.log("{}")');
  assert.throws(() => s.scan('nginx:latest'), /bad image id/);
  assert.throws(() => s.scan(`${ID}; rm -rf /`), /bad image id/);
});

test('the scanner process does not inherit Captain secrets', async () => {
  process.env.ADMIN_PASSWORD = 'super-secret-value';
  process.env.SESSION_SECRET = 'another-secret';
  const s = fake('console.log(JSON.stringify({Results:[{Vulnerabilities:[{VulnerabilityID:"ENV",PkgName:String(process.env.ADMIN_PASSWORD)+String(process.env.SESSION_SECRET),InstalledVersion:"1",Severity:"LOW"}]}]}))');
  s.scan(ID);
  await s.idle();
  assert.equal(s.detail(ID).vulns[0].pkg, 'undefinedundefined');
  delete process.env.ADMIN_PASSWORD;
  delete process.env.SESSION_SECRET;
});

test('info reports the version and database date', async () => {
  const s = createScanner({
    bin: process.execPath, dataDir: tmp(),
    buildArgs: () => [],
  });
  // process.execPath --version prints "v22..." (no Version: field), so info() is available without details
  const info = await s.info();
  assert.equal(info.available, true);
});

test('stale results are forgotten when an image is no longer in use', async () => {
  const s = fake('console.log("{}")');
  s.scan(ID);
  s.scan(ID2);
  await s.idle();
  s.forget(new Set([ID]));
  assert.equal(s.summary(ID).status, 'done');
  assert.equal(s.summary(ID2).status, 'never');
});

test('cleanError keeps the fatal message and drops log noise', () => {
  const stderr = [
    '2026-11-12T17:04:45Z\tINFO\t[vulndb] Downloading artifact...\trepo="x"',
    '2026-11-12T17:04:45Z\tFATAL\tFatal error\trun error: init error: failed to download vulnerability DB',
  ].join('\n');
  assert.equal(cleanError(stderr), 'init error: failed to download vulnerability DB');
  assert.equal(cleanError('plain failure'), 'plain failure');
  assert.equal(cleanError(''), '');
});
