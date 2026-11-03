import os from 'node:os';
import Docker from 'dockerode';

const docker = new Docker({ socketPath: process.env.DOCKER_SOCKET || '/var/run/docker.sock' });

const PROJECT_LABEL = 'com.docker.compose.project';
const selfId = os.hostname();

const isSelf = (id) => id.startsWith(selfId) || selfId.startsWith(id.slice(0, 12));

const policyCache = new Map();
const POLICY_TTL_MS = 30_000;

async function restartPolicies(ids) {
  const now = Date.now();
  await Promise.all(
    ids.map(async (id) => {
      const hit = policyCache.get(id);
      if (hit && now - hit.at < POLICY_TTL_MS) return;
      try {
        const info = await docker.getContainer(id).inspect();
        policyCache.set(id, { name: info.HostConfig?.RestartPolicy?.Name || 'no', at: now });
      } catch {
        policyCache.delete(id);
      }
    }),
  );
}

export async function setAutoStart(id, enabled) {
  await docker.getContainer(id).update({
    RestartPolicy: { Name: enabled ? 'unless-stopped' : 'no' },
  });
  policyCache.delete(id);
}

export async function listContainers() {
  const items = await docker.listContainers({ all: true });
  await restartPolicies(items.map((c) => c.Id));
  return items
    .map((c) => ({
      id: c.Id,
      name: (c.Names?.[0] || c.Id).replace(/^\//, ''),
      image: c.Image,
      state: c.State,
      status: c.Status,
      project: c.Labels?.[PROJECT_LABEL] || null,
      restart: policyCache.get(c.Id)?.name || 'no',
      ports: (c.Ports || [])
        .filter((p) => p.PublicPort)
        .map((p) => `${p.PublicPort}:${p.PrivatePort}`)
        .filter((v, i, a) => a.indexOf(v) === i),
      self: isSelf(c.Id),
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

export function calcStats(s) {
  const cpuDelta = s.cpu_stats.cpu_usage.total_usage - (s.precpu_stats?.cpu_usage?.total_usage ?? 0);
  const sysDelta = (s.cpu_stats.system_cpu_usage ?? 0) - (s.precpu_stats?.system_cpu_usage ?? 0);
  const cpus = s.cpu_stats.online_cpus || s.cpu_stats.cpu_usage.percpu_usage?.length || 1;
  const cpu = sysDelta > 0 && cpuDelta > 0 ? (cpuDelta / sysDelta) * cpus * 100 : 0;

  const cache = s.memory_stats.stats?.inactive_file ?? s.memory_stats.stats?.cache ?? 0;
  const memUsed = Math.max((s.memory_stats.usage ?? 0) - cache, 0);

  let rx = 0;
  let tx = 0;
  for (const n of Object.values(s.networks || {})) {
    rx += n.rx_bytes;
    tx += n.tx_bytes;
  }
  return { cpu, memUsed, memLimit: s.memory_stats.limit ?? 0, netRx: rx, netTx: tx };
}

export async function allStats() {
  const running = await docker.listContainers({ filters: { status: ['running'] } });
  const out = {};
  await Promise.all(
    running.map(async (c) => {
      try {
        const s = await docker.getContainer(c.Id).stats({ stream: false });
        out[c.Id] = calcStats(s);
      } catch {
        /* container vanished between list and stats */
      }
    }),
  );
  return out;
}

export async function containerAction(id, action) {
  if (!['start', 'stop', 'restart'].includes(action)) throw httpError(400, 'bad action');
  if (action !== 'start' && isSelf(id)) throw httpError(403, 'refusing to stop the captain itself');
  const c = docker.getContainer(id);
  try {
    await c[action]();
  } catch (e) {
    // 304 = already in requested state
    if (e.statusCode !== 304) throw e;
  }
}

export async function projectAction(project, action) {
  if (!['up', 'down'].includes(action)) throw httpError(400, 'bad action');
  const all = await listContainers();
  const members = all.filter((c) => c.project === project);
  if (!members.length) throw httpError(404, 'project not found');
  const targets = members.filter((c) =>
    action === 'down' ? c.state === 'running' && !c.self : c.state !== 'running',
  );
  const results = await Promise.allSettled(
    targets.map((c) => containerAction(c.id, action === 'down' ? 'stop' : 'start')),
  );
  return {
    changed: targets.length,
    failed: results.filter((r) => r.status === 'rejected').length,
    skippedSelf: action === 'down' && members.some((c) => c.self),
  };
}

function demux(buf) {
  const lines = [];
  let i = 0;
  while (i + 8 <= buf.length) {
    const size = buf.readUInt32BE(i + 4);
    lines.push(buf.subarray(i + 8, i + 8 + size).toString('utf8'));
    i += 8 + size;
  }
  return lines.join('');
}

export async function logs(id, tail) {
  const c = docker.getContainer(id);
  const info = await c.inspect();
  const buf = await c.logs({ stdout: true, stderr: true, tail, timestamps: true });
  return info.Config.Tty ? buf.toString('utf8') : demux(buf);
}

export async function system() {
  const [info, df] = await Promise.all([docker.info(), docker.df().catch(() => null)]);
  const sumSize = (arr, key) => (arr || []).reduce((n, x) => n + (x[key] || 0), 0);
  return {
    containers: info.Containers,
    running: info.ContainersRunning,
    cpus: info.NCPU,
    memTotal: info.MemTotal,
    dockerVersion: info.ServerVersion,
    disk: df && {
      images: sumSize(df.Images, 'Size'),
      volumes: sumSize(df.Volumes?.map((v) => v.UsageData), 'Size'),
      containers: sumSize(df.Containers, 'SizeRw'),
      buildCache: sumSize(df.BuildCache, 'Size'),
    },
  };
}

export function httpError(status, message) {
  return Object.assign(new Error(message), { status });
}

const ANON_VOLUME = /^[0-9a-f]{64}$/;
const DEFAULT_NETWORKS = new Set(['bridge', 'host', 'none']);
const STALE_DAYS = 7;

export async function cleanupPreview() {
  const [all, images, networks, df] = await Promise.all([
    docker.listContainers({ all: true }),
    docker.listImages({ filters: { dangling: ['true'] } }),
    docker.listNetworks(),
    docker.df().catch(() => ({})),
  ]);

  const stoppedItems = all.filter((c) => ['exited', 'dead', 'created'].includes(c.State) && !isSelf(c.Id));
  const containers = await Promise.all(
    stoppedItems.map(async (c) => {
      const info = await docker.getContainer(c.Id).inspect({ size: true });
      const finished = info.State?.FinishedAt;
      const finishedAt = finished && !finished.startsWith('0001') ? finished : null;
      const ageDays = finishedAt ? (Date.now() - Date.parse(finishedAt)) / 86_400_000 : null;
      return {
        id: c.Id,
        name: (c.Names?.[0] || c.Id).replace(/^\//, ''),
        image: c.Image,
        project: c.Labels?.[PROJECT_LABEL] || null,
        finishedAt,
        ageDays,
        size: info.SizeRw || 0,
        stale: ageDays !== null && ageDays >= STALE_DAYS,
      };
    }),
  );

  const usedNetworks = new Set(all.flatMap((c) => Object.keys(c.NetworkSettings?.Networks || {})));
  const unusedNetworks = networks
    .filter((n) => !DEFAULT_NETWORKS.has(n.Name) && !usedNetworks.has(n.Name))
    .map((n) => n.Name);

  const volumes = (df.Volumes || [])
    .filter((v) => v.UsageData?.RefCount === 0)
    .map((v) => ({
      name: v.Name,
      size: Math.max(v.UsageData?.Size ?? 0, 0),
      anonymous: ANON_VOLUME.test(v.Name),
    }));

  const cache = (df.BuildCache || []).filter((b) => !b.InUse);

  return {
    staleDays: STALE_DAYS,
    containers: containers.sort((a, b) => (b.ageDays ?? 0) - (a.ageDays ?? 0)),
    images: { count: images.length, size: images.reduce((n, i) => n + (i.Size || 0), 0) },
    networks: unusedNetworks,
    volumes,
    buildCache: { count: cache.length, size: cache.reduce((n, b) => n + (b.Size || 0), 0) },
  };
}

const strings = (v) => (Array.isArray(v) ? v.filter((x) => typeof x === 'string') : []);

export async function cleanupRun(body = {}) {
  const removed = { containers: 0, images: 0, networks: 0, volumes: 0, buildCache: false };
  const failed = [];
  let reclaimed = 0;

  for (const id of strings(body.containers)) {
    try {
      const c = docker.getContainer(id);
      const info = await c.inspect();
      if (info.State?.Running || isSelf(info.Id)) throw httpError(409, 'container is running');
      // keep volumes: only the container itself is removed
      await c.remove({ v: false });
      removed.containers += 1;
    } catch (e) {
      failed.push(`container ${id.slice(0, 12)}: ${e.message}`);
    }
  }

  if (body.images === true) {
    try {
      const r = await docker.pruneImages({ filters: { dangling: ['true'] } });
      removed.images = r.ImagesDeleted?.length || 0;
      reclaimed += r.SpaceReclaimed || 0;
    } catch (e) {
      failed.push(`images: ${e.message}`);
    }
  }

  for (const name of strings(body.networks)) {
    if (DEFAULT_NETWORKS.has(name)) continue;
    try {
      await docker.getNetwork(name).remove();
      removed.networks += 1;
    } catch (e) {
      failed.push(`network ${name}: ${e.message}`);
    }
  }

  for (const name of strings(body.volumes)) {
    try {
      // no force: Docker refuses if a container still references the volume
      await docker.getVolume(name).remove();
      removed.volumes += 1;
    } catch (e) {
      failed.push(`volume ${name.slice(0, 16)}: ${e.message}`);
    }
  }

  if (body.buildCache === true) {
    try {
      const r = await new Promise((resolve, reject) =>
        docker.modem.dial(
          { path: '/build/prune?all=true', method: 'POST', statusCodes: { 200: true, 500: 'server error' } },
          (err, data) => (err ? reject(err) : resolve(data)),
        ));
      removed.buildCache = true;
      reclaimed += r?.SpaceReclaimed || 0;
    } catch (e) {
      failed.push(`build cache: ${e.message}`);
    }
  }

  return { removed, reclaimed, failed };
}
