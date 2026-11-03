// In-memory fake Docker backend: same interface as docker.js, used when DEMO=true.
const GB = 1024 ** 3;
const MB = 1024 ** 2;
const now = Date.now();
const days = (n) => now - n * 86_400_000;

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
      state: c.state, ports: c.ports, self: c.self,
      status: c.state === 'running' ? `Up ${3 + (c.name.length % 9)} days` : `Exited ${Math.round((now - c.stoppedAt) / 86_400_000)} days ago`,
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
