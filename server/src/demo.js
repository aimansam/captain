// In-memory fake Docker backend: same interface as docker.js, used when DEMO=true.
import crypto from 'node:crypto';
import { buildReport, daemonReport, evaluate, riskOf } from './security.js';
const GB = 1024 ** 3;
const MB = 1024 ** 2;
const now = Date.now();
const days = (n) => now - n * 86_400_000;

const ago = (t) => {
  const mins = (Date.now() - t) / 60_000;
  if (mins < 60) return 'just now';
  if (mins < 1440) return `${Math.round(mins / 60)} hours ago`;
  return `${Math.round(mins / 1440)} days ago`;
};

const mk = (name, image, project, o = {}) => ({
  id: Buffer.from(name).toString('hex').padEnd(64, '0').slice(0, 64),
  name, image, project,
  state: 'running', restart: 'unless-stopped', rebuildable: false, ports: [], self: false,
  cpu: 1, mem: 100 * MB, rx: 1e6, tx: 5e5, stoppedAt: null, size: 0,
  ...o,
});

let state = [
  mk('jellyfin', 'jellyfin/jellyfin:10.9', 'media', { rebuildable: true, ports: ['8096:8096'], cpu: 6, mem: 820 * MB }),
  mk('sonarr', 'linuxserver/sonarr:4', 'media', { rebuildable: true, ports: ['8989:8989'], cpu: 1.2, mem: 240 * MB }),
  mk('radarr', 'linuxserver/radarr:5', 'media', { rebuildable: true, ports: ['7878:7878'], cpu: 0.8, mem: 210 * MB }),
  mk('qbittorrent', 'linuxserver/qbittorrent:4.6', 'media', { rebuildable: true, ports: ['8080:8080'], cpu: 3.4, mem: 380 * MB }),
  mk('shop-web', 'acme/shop-web:2.4.1', 'shop', { rebuildable: true, ports: ['3000:3000'], cpu: 2.1, mem: 190 * MB }),
  mk('shop-api', 'acme/shop-api:2.4.1', 'shop', { rebuildable: true, ports: ['4000:4000'], cpu: 4.7, mem: 420 * MB }),
  mk('shop-worker', 'acme/shop-api:2.4.1', 'shop', { rebuildable: true, cpu: 9.5, mem: 510 * MB }),
  mk('shop-postgres', 'postgres:16', 'shop', { rebuildable: true, cpu: 1.9, mem: 640 * MB, restart: 'always' }),
  mk('shop-redis', 'redis:7-alpine', 'shop', { rebuildable: true, cpu: 0.4, mem: 28 * MB }),
  mk('grafana', 'grafana/grafana:11', 'monitoring', { ports: ['3001:3000'], cpu: 0.9, mem: 260 * MB }),
  mk('prometheus', 'prom/prometheus:v2.54', 'monitoring', { ports: ['9090:9090'], cpu: 2.3, mem: 540 * MB }),
  mk('node-exporter', 'prom/node-exporter:v1.8', 'monitoring', { cpu: 0.2, mem: 18 * MB }),
  mk('nginx-proxy', 'nginx:1.27-alpine', null, { ports: ['80:80', '443:443'], cpu: 0.6, mem: 22 * MB }),
  mk('pihole', 'pihole/pihole:2024.07', null, { ports: ['53:53', '8081:80'], cpu: 0.5, mem: 95 * MB }),
  mk('old-experiment', 'node:18', null, { state: 'exited', restart: 'no', stoppedAt: days(34), size: 212 * MB }),
  mk('test-nginx', 'nginx:latest', null, { state: 'exited', restart: 'no', stoppedAt: days(2), size: 1 * MB }),
  mk('captain', 'ghcr.io/aimansam/captain:latest', null, { ports: ['8787:8787'], cpu: 0.3, mem: 48 * MB, self: true }),
];

let junk = {
  images: { count: 5, size: 1.4 * GB },
  buildCache: { count: 87, size: 6.2 * GB },
  networks: ['old-experiment_default', 'testnet'],
  volumes: [
    { name: 'a3f1c9d2e7b84a6f5c0d9e1b2a3c4d5e6f708192a3b4c5d6e7f8091a2b3c4d5e', size: 310 * MB, anonymous: true },
    { name: 'old-experiment_data', size: 1.8 * GB, anonymous: false },
  ],
};

const err = (status, message) => Object.assign(new Error(message), { status });
const find = (id) => state.find((c) => c.id === id) || (() => { throw err(404, 'no such container'); })();
const jitter = (v, pct = 0.25) => Math.max(0, v * (1 + (Math.random() * 2 - 1) * pct));

export async function listContainers() {
  return state
    .map((c) => ({
      id: c.id, name: c.name, image: c.image, project: c.project, restart: c.restart, rebuildable: c.rebuildable,
      risk: ['high', 'medium'].includes(riskOf(evaluate(inspectOf(c), { self: c.self }))) ? riskOf(evaluate(inspectOf(c), { self: c.self })) : null,
      state: c.state, ports: c.ports, self: c.self,
      status: c.state === 'running' ? `Up ${3 + (c.name.length % 9)} days` : `Exited ${ago(c.stoppedAt)}`,
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

export async function allStats() {
  const out = {};
  for (const c of state.filter((x) => x.state === 'running')) {
    c.rx += Math.round(jitter(40_000));
    c.tx += Math.round(jitter(20_000));
    out[c.id] = {
      cpu: jitter(c.cpu), memUsed: Math.round(jitter(c.mem, 0.04)), memLimit: 32 * GB,
      netRx: c.rx, netTx: c.tx,
    };
  }
  return out;
}

export async function system() {
  return {
    containers: state.length,
    running: state.filter((c) => c.state === 'running').length,
    cpus: 8, memTotal: 32 * GB, dockerVersion: '27.3.1',
    disk: { images: 18.4 * GB, volumes: 9.7 * GB, containers: 0.4 * GB, buildCache: junk.buildCache.size },
  };
}

export async function containerAction(id, action) {
  const c = find(id);
  if (!['start', 'stop', 'restart'].includes(action)) throw err(400, 'bad action');
  if (action !== 'start' && c.self) throw err(403, 'refusing to stop the captain itself');
  c.state = action === 'stop' ? 'exited' : 'running';
  c.stoppedAt = action === 'stop' ? Date.now() : null;
}

export async function projectAction(project, action) {
  if (!['up', 'down'].includes(action)) throw err(400, 'bad action');
  const members = state.filter((c) => c.project === project);
  if (!members.length) throw err(404, 'project not found');
  const targets = members.filter((c) => (action === 'down' ? c.state === 'running' : c.state !== 'running'));
  targets.forEach((c) => {
    c.state = action === 'down' ? 'exited' : 'running';
    c.stoppedAt = action === 'down' ? Date.now() : null;
  });
  return { changed: targets.length, failed: 0, skippedSelf: false };
}

export async function setAutoStart(id, enabled) {
  find(id).restart = enabled ? 'unless-stopped' : 'no';
}

export async function logs(id, tail = 200) {
  const c = find(id);
  const lines = [];
  for (let i = tail > 60 ? 60 : tail; i > 0; i--) {
    const t = new Date(Date.now() - i * 4000).toISOString();
    const msg = [
      `GET /health 200 ${2 + (i % 5)}ms`,
      `processed job #${48210 + i} in ${120 + (i * 7) % 90}ms`,
      `connection pool: ${3 + (i % 4)}/20 in use`,
      i % 17 === 0 ? 'WARN slow query detected (812ms)' : `cache hit ratio 0.${90 + (i % 9)}`,
    ][i % 4];
    lines.push(`${t} [${c.name}] ${msg}`);
  }
  return `${lines.join('\n')}\n`;
}

export async function cleanupPreview() {
  const stopped = state.filter((c) => c.state !== 'running' && !c.self);
  return {
    staleDays: 7,
    containers: stopped.map((c) => {
      const ageDays = (Date.now() - c.stoppedAt) / 86_400_000;
      return {
        id: c.id, name: c.name, image: c.image, project: c.project,
        finishedAt: new Date(c.stoppedAt).toISOString(), ageDays, size: c.size, stale: ageDays >= 7,
      };
    }).sort((a, b) => b.ageDays - a.ageDays),
    images: junk.images, networks: junk.networks, volumes: junk.volumes, buildCache: junk.buildCache,
  };
}

const list = (v) => (Array.isArray(v) ? v : []);

export async function cleanupRun(body = {}) {
  const removed = { containers: 0, images: 0, networks: 0, volumes: 0, buildCache: false };
  let reclaimed = 0;
  const failed = [];

  for (const id of list(body.containers)) {
    const c = state.find((x) => x.id === id);
    if (!c) continue;
    if (c.state === 'running' || c.self) { failed.push(`container ${c.name}: container is running`); continue; }
    state = state.filter((x) => x.id !== id);
    removed.containers += 1;
  }
  if (body.images === true && junk.images.count) {
    removed.images = junk.images.count;
    reclaimed += junk.images.size;
    junk.images = { count: 0, size: 0 };
  }
  if (body.buildCache === true && junk.buildCache.count) {
    removed.buildCache = true;
    reclaimed += junk.buildCache.size;
    junk.buildCache = { count: 0, size: 0 };
  }
  for (const n of list(body.networks)) {
    if (junk.networks.includes(n)) { junk.networks = junk.networks.filter((x) => x !== n); removed.networks += 1; }
  }
  for (const v of list(body.volumes)) {
    if (junk.volumes.some((x) => x.name === v)) { junk.volumes = junk.volumes.filter((x) => x.name !== v); removed.volumes += 1; }
  }
  return { removed, reclaimed, failed };
}

const demoJobs = new Map();
const rebuildScript = (project, pull) => [
  ...(pull ? [`$ docker compose -p ${project} pull --ignore-buildable`, ' ✔ Image redis:7-alpine  Pulled', ' ✔ Image postgres:16     Pulled'] : []),
  `$ docker compose -p ${project} up -d --build`,
  '#1 [api internal] load build definition from Dockerfile',
  '#2 [api internal] load metadata for docker.io/library/node:22-alpine',
  '#3 [api 1/5] FROM docker.io/library/node:22-alpine',
  '#4 [api 3/5] RUN npm ci --omit=dev',
  '#5 [api 5/5] COPY . .',
  '#6 [api] exporting to image',
  ' Container shop-api  Recreate',
  ' Container shop-api  Recreated',
  ' Container shop-api  Started',
];

export async function startRebuild(project, { pull = false } = {}) {
  const members = state.filter((c) => c.project === project);
  if (!members.length) throw err(404, 'project not found');
  if (!members.some((c) => c.rebuildable)) throw err(409, 'Compose files are not reachable from Captain.');
  if ([...demoJobs.values()].some((j) => j.project === project && Date.now() - j.startedAt < j.lines.length * 450)) {
    throw err(409, `a rebuild of "${project}" is already running`);
  }
  const id = `demo-${demoJobs.size + 1}`;
  demoJobs.set(id, { id, project, startedAt: Date.now(), lines: rebuildScript(project, pull) });
  return { jobId: id };
}

export async function getJob(id) {
  const j = demoJobs.get(id);
  if (!j) throw err(404, 'no such job');
  const shown = Math.min(j.lines.length, Math.floor((Date.now() - j.startedAt) / 450) + 1);
  const done = shown >= j.lines.length;
  return {
    id, project: j.project, status: done ? 'done' : 'running', exitCode: done ? 0 : null,
    output: `${j.lines.slice(0, shown).join('\n')}\n`, step: 1, steps: 1, startedAt: j.startedAt,
  };
}

// ---- security (fake data, real check logic) ------------------------------

const open = (port) => ({ [`${port}/tcp`]: [{ HostIp: '0.0.0.0', HostPort: String(port) }] });
const SEC = {
  'shop-postgres': { user: 'postgres', memory: 1 * GB, hc: true, bindings: open(5432) },
  'shop-redis': { user: 'redis', memory: 256 * MB, hc: true },
  'shop-api': { memory: 512 * MB, hc: true },
  'shop-web': { memory: 512 * MB, hc: true },
  jellyfin: { memory: 2 * GB, hc: true, bindings: open(8096) },
  qbittorrent: { user: '1000', memory: 1 * GB, hc: true, bindings: open(8080) },
  sonarr: { user: '1000', memory: 512 * MB },
  radarr: { user: '1000', memory: 512 * MB },
  grafana: { user: '472', memory: 512 * MB, hc: true },
  prometheus: { user: 'nobody', memory: 1 * GB, hc: true },
  'node-exporter': { user: 'nobody', pid: 'host', labels: { 'captain.security.ignore': 'host-pid' }, hc: true },
  'nginx-proxy': { memory: 256 * MB, hc: true, bindings: { ...open(80), ...open(443) } },
  pihole: { net: 'host', caps: ['NET_ADMIN'], hc: true },
};

function inspectOf(c) {
  const o = SEC[c.name] || {};
  const local = Object.fromEntries(c.ports.map((p) => {
    const [host, priv] = p.split(':');
    return [`${priv}/tcp`, [{ HostIp: '127.0.0.1', HostPort: host }]];
  }));
  return {
    Id: c.id,
    Config: {
      User: o.user ?? '', Image: c.image, Labels: o.labels || {},
      Healthcheck: o.hc ? { Test: ['CMD', 'true'] } : undefined,
    },
    HostConfig: {
      Privileged: false, NetworkMode: o.net || 'bridge', PidMode: o.pid || '', CapAdd: o.caps || [],
      Memory: o.memory || 0, SecurityOpt: [], PortBindings: o.bindings || local,
    },
    Mounts: c.self ? [{ Type: 'bind', Source: '/var/run/docker.sock', RW: true }] : [],
  };
}

export async function securityChecks() {
  const containers = state.map((c) => ({
    id: c.id, name: c.name, project: c.project, findings: evaluate(inspectOf(c), { self: c.self }),
  }));
  return {
    ...buildReport(containers),
    daemon: daemonReport({
      SecurityOptions: ['name=seccomp,profile=builtin', 'name=cgroupns'],
      ServerVersion: '27.3.1', Driver: 'overlay2', CgroupVersion: '2',
    }),
  };
}

const imageId = (image) => `sha256:${crypto.createHash('sha256').update(image).digest('hex')}`;

// counts per image: [critical, high, medium, low]; undefined = not scanned yet
const FAKE_COUNTS = {
  'jellyfin/jellyfin:10.9': [0, 2, 9, 14], 'linuxserver/sonarr:4': [1, 4, 11, 20],
  'linuxserver/radarr:5': [1, 4, 11, 20], 'linuxserver/qbittorrent:4.6': [0, 3, 8, 12],
  'acme/shop-api:2.4.1': [2, 7, 15, 31], 'postgres:16': [0, 1, 6, 18], 'redis:7-alpine': [0, 0, 2, 5],
  'grafana/grafana:11': [0, 2, 5, 9], 'prom/prometheus:v2.54': [0, 1, 3, 4], 'prom/node-exporter:v1.8': [0, 0, 1, 2],
  'nginx:1.27-alpine': [0, 1, 4, 6], 'pihole/pihole:2024.07': [0, 2, 7, 13], 'node:18': [3, 12, 28, 40],
  'ghcr.io/aimansam/captain:latest': [0, 0, 2, 3],
};
const PKGS = ['openssl', 'libssl3', 'zlib', 'busybox', 'glibc', 'curl', 'libxml2', 'nghttp2', 'sqlite-libs', 'expat', 'libcrypto3', 'musl'];
const SEV = ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'];

function fakeVulns(image, counts) {
  const seed = crypto.createHash('sha256').update(image).digest();
  let n = 0;
  const out = [];
  counts.forEach((count, si) => {
    for (let i = 0; i < Math.min(count, 40); i++, n++) {
      const b = seed[n % seed.length];
      const pkg = PKGS[(b + i) % PKGS.length];
      const fixed = (b + i) % 3 === 0 ? '' : `1.${b % 9}.${(i % 7) + 1}`;
      out.push({
        id: `CVE-2024-${String(10000 + ((b * 131 + n * 977) % 40000))}`,
        pkg, installed: `1.${b % 9}.0`, fixed, severity: SEV[si],
        title: `Demo finding in ${pkg} (illustrative data)`,
      });
    }
  });
  return out;
}

const scans = new Map(); // imageId -> { startedAt }

function scanState(image) {
  const id = imageId(image);
  const counts = FAKE_COUNTS[image];
  const run = scans.get(id);
  const sum = (c) => ({
    critical: c[0], high: c[1], medium: c[2], low: c[3], unknown: 0,
  });
  const done = {
    status: 'done', phase: null, scannedAt: Date.now() - 3 * 3_600_000, counts: counts && sum(counts),
    total: counts?.reduce((a, b) => a + b, 0), fixable: counts && Math.round(counts.reduce((a, b) => a + b, 0) * 0.62),
  };
  if (run) {
    const t = Date.now() - run.startedAt;
    if (t < 1300) return { status: 'scanning', phase: 'updating-db' };
    if (t < 2800) return { status: 'scanning', phase: 'scanning' };
    return { ...done, scannedAt: run.startedAt + 2800 };
  }
  return counts && image !== 'acme/shop-web:2.4.1' && image !== 'nginx:latest' ? done : { status: 'never' };
}

function demoTargets() {
  const map = new Map();
  for (const c of state) {
    if (!map.has(c.image)) map.set(c.image, { imageId: imageId(c.image), image: c.image, tags: [c.image], size: 120 * MB + (c.image.length * 7 * MB), containers: [] });
    map.get(c.image).containers.push(c.name);
  }
  return [...map.values()];
}

export async function securityStatus() {
  const scanning = [...scans.values()].some((s) => Date.now() - s.startedAt < 2800);
  return { available: true, version: '0.76.2', dbUpdatedAt: new Date(Date.now() - 3 * 3_600_000).toISOString(), queued: 0, scanning };
}

export async function securityImages() {
  return demoTargets()
    .map(({ image, ...t }) => ({ ...t, ...scanState(image) }))
    .sort((a, b) => b.containers.length - a.containers.length || a.tags[0].localeCompare(b.tags[0]));
}

export async function securityImage(id) {
  const t = demoTargets().find((x) => x.imageId === id);
  if (!t) throw err(404, 'image has not been scanned');
  const s = scanState(t.image);
  if (s.status !== 'done') throw err(404, 'image has not been scanned');
  return { imageId: id, ...s, vulns: fakeVulns(t.image, FAKE_COUNTS[t.image] || [0, 0, 0, 0]) };
}

export async function securityScan({ imageId: id, all = false } = {}) {
  const targets = demoTargets();
  const chosen = all ? targets : targets.filter((t) => t.imageId === id);
  if (!chosen.length) throw err(404, 'image is not used by any container');
  for (const t of chosen) {
    FAKE_COUNTS[t.image] ||= [0, 1, 3, 5];
    scans.set(t.imageId, { startedAt: Date.now() });
  }
  return { queued: chosen.length };
}
