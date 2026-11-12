import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildReport, CHECKS, daemonReport, evaluate, riskOf } from '../src/security.js';

// A well-configured container: non-root, limited, healthchecked, pinned, no published ports.
const clean = (over = {}) => ({
  Id: 'abc',
  Config: { User: '1000', Image: 'app:1.2', Healthcheck: { Test: ['CMD', 'true'] }, Labels: {}, ...over.Config },
  HostConfig: { Memory: 1 << 28, NetworkMode: 'bridge', PortBindings: {}, ...over.HostConfig },
  Mounts: over.Mounts || [],
});
const ids = (findings) => findings.map((f) => f.check).sort();

test('a well-configured container has no findings', () => {
  assert.deepEqual(evaluate(clean()), []);
});

test('privileged, host namespaces and dangerous capabilities are high', () => {
  const f = evaluate(clean({ HostConfig: { Privileged: true, PidMode: 'host', IpcMode: 'host', CapAdd: ['CAP_SYS_ADMIN', 'CHOWN'] } }));
  assert.deepEqual(ids(f), ['dangerous-cap', 'host-ipc', 'host-pid', 'privileged']);
  assert.ok(f.every((x) => x.severity === 'high'));
  assert.equal(f.find((x) => x.check === 'dangerous-cap').detail, 'SYS_ADMIN');
});

test('docker.sock mount is flagged, and accepted for Captain itself', () => {
  const mounts = [{ Type: 'bind', Source: '/var/run/docker.sock', RW: true }];
  assert.equal(evaluate(clean({ Mounts: mounts })).find((x) => x.check === 'docker-sock').ignored, false);
  assert.equal(evaluate(clean({ Mounts: mounts }), { self: true }).find((x) => x.check === 'docker-sock').ignored, true);
});

test('only writable bind mounts of system paths count as sensitive', () => {
  const f = (m) => ids(evaluate(clean({ Mounts: [m] })));
  assert.deepEqual(f({ Type: 'bind', Source: '/etc', RW: true }), ['sensitive-mount']);
  assert.deepEqual(f({ Type: 'bind', Source: '/etc', RW: false }), []);
  assert.deepEqual(f({ Type: 'bind', Source: '/srv/data', RW: true }), []);
  assert.deepEqual(f({ Type: 'volume', Source: '/var/lib/docker', RW: true }), []);
});

test('published ports: database ports are high, others medium, loopback is fine', () => {
  const ports = (HostIp, port) => ({ [`${port}/tcp`]: [{ HostIp, HostPort: String(port) }] });
  const f = (PortBindings) => evaluate(clean({ HostConfig: { PortBindings } }));
  assert.deepEqual(ids(f(ports('0.0.0.0', 5432))), ['db-port-exposed']);
  assert.deepEqual(ids(f(ports('', 8080))), ['port-all-interfaces']);
  assert.deepEqual(ids(f(ports('::', 8080))), ['port-all-interfaces']);
  assert.deepEqual(ids(f(ports('127.0.0.1', 5432))), []);
  assert.deepEqual(ids(f({ ...ports('0.0.0.0', 5432), ...ports('0.0.0.0', 80) })), ['db-port-exposed', 'port-all-interfaces']);
});

test('host network is medium and skips port checks', () => {
  const f = evaluate(clean({ HostConfig: { NetworkMode: 'host', PortBindings: { '80/tcp': [{ HostIp: '0.0.0.0' }] } } }));
  assert.deepEqual(ids(f), ['host-network']);
  assert.equal(f[0].severity, 'medium');
});

test('unconfined security profiles are flagged', () => {
  assert.deepEqual(ids(evaluate(clean({ HostConfig: { SecurityOpt: ['seccomp=unconfined'] } }))), ['unconfined']);
  assert.deepEqual(ids(evaluate(clean({ HostConfig: { SecurityOpt: ['no-new-privileges'] } }))), []);
});

test('root user, memory limit, healthcheck and image pinning are low', () => {
  for (const user of ['', '0', 'root', '0:0', 'root:root']) {
    assert.ok(ids(evaluate(clean({ Config: { User: user } }))).includes('root-user'), `user "${user}"`);
  }
  assert.ok(!ids(evaluate(clean({ Config: { User: 'app:app' } }))).includes('root-user'));
  assert.deepEqual(ids(evaluate(clean({ HostConfig: { Memory: 0 } }))), ['no-memory-limit']);
  assert.deepEqual(ids(evaluate(clean({ Config: { Healthcheck: undefined } }))), ['no-healthcheck']);
  assert.deepEqual(ids(evaluate(clean({ Config: { Healthcheck: { Test: ['NONE'] } } }))), ['no-healthcheck']);
  for (const image of ['nginx', 'nginx:latest', 'ghcr.io/x/y']) {
    assert.deepEqual(ids(evaluate(clean({ Config: { Image: image } }))), ['latest-tag'], image);
  }
  for (const image of ['nginx:1.27', 'registry:5000/x/y:2', 'x@sha256:abc', 'sha256:abc']) {
    assert.deepEqual(ids(evaluate(clean({ Config: { Image: image } }))), [], image);
  }
});

test('the ignore label accepts findings without hiding them', () => {
  const f = evaluate(clean({
    Config: { User: '', Labels: { 'captain.security.ignore': 'root-user, host-pid' } },
    HostConfig: { PidMode: 'host' },
  }));
  assert.ok(f.every((x) => x.ignored));
  assert.equal(riskOf(f), null);
});

test('risk is the highest unaccepted severity', () => {
  assert.equal(riskOf([]), null);
  assert.equal(riskOf([{ severity: 'low' }, { severity: 'high', ignored: true }]), 'low');
  assert.equal(riskOf([{ severity: 'low' }, { severity: 'medium' }, { severity: 'high' }]), 'high');
});

test('every check in the catalog has severity, title and a fix', () => {
  for (const [id, c] of Object.entries(CHECKS)) {
    assert.ok(['high', 'medium', 'low'].includes(c.severity), id);
    assert.ok(c.title && c.why && c.fix, id);
  }
});

test('report counts open findings and sorts by severity then affected containers', () => {
  const a = { id: '1', name: 'a', project: null, findings: evaluate(clean({ HostConfig: { Privileged: true, Memory: 0 } })) };
  const b = { id: '2', name: 'b', project: 'p', findings: evaluate(clean({ HostConfig: { Memory: 0 } })) };
  const c = { id: '3', name: 'c', project: 'p', findings: evaluate(clean({ Config: { Labels: { 'captain.security.ignore': 'no-memory-limit' } }, HostConfig: { Memory: 0 } })) };
  const r = buildReport([b, c, a]);
  assert.deepEqual(r.summary, { high: 1, medium: 0, low: 2 });
  assert.equal(r.checks[0].check, 'privileged');
  const mem = r.checks.find((x) => x.check === 'no-memory-limit');
  assert.equal(mem.containers.length, 3);
  assert.equal(mem.open, 2);
  assert.deepEqual(r.containers.map((x) => x.name), ['a', 'b', 'c']);
  assert.equal(r.containers[0].risk, 'high');
});

test('daemon report flags a missing seccomp profile', () => {
  const ok = daemonReport({ SecurityOptions: ['name=seccomp,profile=builtin', 'name=rootless'], ServerVersion: '27', CgroupVersion: '2' });
  assert.deepEqual(ok.findings, []);
  assert.equal(ok.rootless, true);
  assert.equal(ok.cgroup, 'v2');
  assert.equal(daemonReport({ SecurityOptions: [] }).findings.length, 1);
});
