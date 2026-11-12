// Pure configuration checks over `docker inspect` output. No Docker or filesystem access.

export const SEVERITIES = ['high', 'medium', 'low'];
const RANK = { high: 3, medium: 2, low: 1 };

export const CHECKS = {
  privileged: {
    severity: 'high', title: 'Privileged container',
    why: 'A privileged container has almost the same access as root on the host.',
    fix: 'Remove `privileged: true`. Add only the specific capabilities or devices it needs.',
  },
  'host-pid': {
    severity: 'high', title: 'Shares the host PID namespace',
    why: 'It can see and signal every process on the host.',
    fix: 'Remove `pid: host`.',
  },
  'host-ipc': {
    severity: 'high', title: 'Shares the host IPC namespace',
    why: 'It can read shared memory used by host processes.',
    fix: 'Remove `ipc: host`.',
  },
  'docker-sock': {
    severity: 'high', title: 'Docker socket mounted',
    why: 'Whoever controls this container can control Docker and, through it, the whole host.',
    fix: 'Avoid mounting /var/run/docker.sock. If it is required, accept the risk with the label `captain.security.ignore=docker-sock`.',
  },
  'sensitive-mount': {
    severity: 'high', title: 'Sensitive host path mounted read-write',
    why: 'A writable bind mount of a system directory lets the container modify the host.',
    fix: 'Mount a narrower path, or make the mount read-only (`:ro`).',
  },
  'dangerous-cap': {
    severity: 'high', title: 'Dangerous Linux capability added',
    why: 'Capabilities such as SYS_ADMIN or NET_ADMIN greatly widen what a compromised container can do.',
    fix: 'Drop the capability, or use `cap_drop: [ALL]` and add back only what is needed.',
  },
  'db-port-exposed': {
    severity: 'high', title: 'Database port published on all interfaces',
    why: 'A database reachable from your whole network (or the internet) is a common way in.',
    fix: 'Bind it to localhost (`127.0.0.1:5432:5432`) or remove the published port and use a Docker network.',
  },
  'host-network': {
    severity: 'medium', title: 'Uses the host network',
    why: 'It bypasses Docker network isolation and can reach services bound to localhost on the host.',
    fix: 'Use a bridge network and publish only the ports you need.',
  },
  unconfined: {
    severity: 'medium', title: 'Security profile disabled',
    why: 'seccomp or AppArmor is set to unconfined, removing the default syscall filtering.',
    fix: 'Remove `seccomp=unconfined` / `apparmor=unconfined` from `security_opt`.',
  },
  'port-all-interfaces': {
    severity: 'medium', title: 'Port published on all interfaces',
    why: 'The service is reachable from every network the host is on.',
    fix: 'Bind to a specific address (`192.168.1.10:8080:80` or `127.0.0.1:...`) if it should not be public.',
  },
  'root-user': {
    severity: 'low', title: 'Runs as root',
    why: 'If the process is compromised, it starts with root privileges inside the container.',
    fix: 'Set `user:` in compose, or use an image that drops privileges.',
  },
  'no-memory-limit': {
    severity: 'low', title: 'No memory limit',
    why: 'A runaway process can use all host memory.',
    fix: 'Set `mem_limit` (or `deploy.resources.limits.memory`).',
  },
  'no-healthcheck': {
    severity: 'low', title: 'No healthcheck',
    why: 'Docker cannot tell when the service is unhealthy, so it will not be restarted or flagged.',
    fix: 'Add a `healthcheck:` to the service.',
  },
  'latest-tag': {
    severity: 'low', title: 'Image is not pinned (latest or untagged)',
    why: 'Pulls can silently change the running version.',
    fix: 'Pin a version tag or digest.',
  },
};

const DB_PORTS = new Set([5432, 3306, 6379, 27017, 9200, 11211, 1433, 5984]);
const SENSITIVE_PATHS = new Set(['/', '/etc', '/root', '/proc', '/sys', '/boot', '/dev', '/var/lib/docker']);
const DANGEROUS_CAPS = new Set(['SYS_ADMIN', 'ALL', 'SYS_PTRACE', 'NET_ADMIN', 'SYS_MODULE', 'DAC_READ_SEARCH']);
const ALL_INTERFACES = new Set(['', '0.0.0.0', '::']);

export const IGNORE_LABEL = 'captain.security.ignore';

const isRoot = (user = '') => user === '' || /^(0|root)(:|$)/.test(user);

function exposedPorts(hostConfig) {
  const out = [];
  for (const [key, bindings] of Object.entries(hostConfig?.PortBindings || {})) {
    const port = Number(key.split('/')[0]);
    for (const b of bindings || []) {
      if (ALL_INTERFACES.has(b.HostIp ?? '')) out.push(port);
    }
  }
  return [...new Set(out)];
}

/**
 * @param inspect  result of docker.getContainer(id).inspect()
 * @param opts.self true for Captain's own container (its docker.sock mount is expected)
 * @returns findings: [{ check, severity, title, detail, ignored }]
 */
export function evaluate(inspect, { self = false } = {}) {
  const hc = inspect.HostConfig || {};
  const cfg = inspect.Config || {};
  const found = [];
  const add = (check, detail = '') => found.push({ check, detail });

  if (hc.Privileged) add('privileged');
  if (hc.PidMode === 'host') add('host-pid');
  if (hc.IpcMode === 'host') add('host-ipc');

  const mounts = inspect.Mounts || [];
  if (mounts.some((m) => m.Source === '/var/run/docker.sock' || m.Source === '/run/docker.sock')) add('docker-sock');
  const sensitive = mounts
    .filter((m) => m.Type === 'bind' && m.RW && SENSITIVE_PATHS.has(m.Source))
    .map((m) => m.Source);
  if (sensitive.length) add('sensitive-mount', sensitive.join(', '));

  const caps = (hc.CapAdd || []).map((c) => c.replace(/^CAP_/, '').toUpperCase()).filter((c) => DANGEROUS_CAPS.has(c));
  if (caps.length) add('dangerous-cap', caps.join(', '));

  if (hc.NetworkMode === 'host') {
    add('host-network');
  } else {
    const ports = exposedPorts(hc);
    const db = ports.filter((p) => DB_PORTS.has(p));
    const other = ports.filter((p) => !DB_PORTS.has(p));
    if (db.length) add('db-port-exposed', db.join(', '));
    if (other.length) add('port-all-interfaces', other.join(', '));
  }

  if ((hc.SecurityOpt || []).some((o) => /^(seccomp|apparmor)[=:]unconfined$/.test(o))) add('unconfined');
  if (isRoot(cfg.User)) add('root-user');
  if (!hc.Memory) add('no-memory-limit');
  if (!cfg.Healthcheck || (cfg.Healthcheck.Test || [])[0] === 'NONE') add('no-healthcheck');

  const image = cfg.Image || '';
  if (!image.includes('@') && !/^sha256:/.test(image) && (!image.split('/').pop().includes(':') || image.endsWith(':latest'))) {
    add('latest-tag', image);
  }

  const ignored = new Set(
    String(cfg.Labels?.[IGNORE_LABEL] || '').split(',').map((s) => s.trim()).filter(Boolean),
  );
  if (self) ignored.add('docker-sock');

  return found.map((f) => ({
    ...f,
    severity: CHECKS[f.check].severity,
    title: CHECKS[f.check].title,
    ignored: ignored.has(f.check),
  }));
}

/** Highest severity among findings that were not accepted, or null. */
export function riskOf(findings) {
  let best = null;
  for (const f of findings) {
    if (!f.ignored && (!best || RANK[f.severity] > RANK[best])) best = f.severity;
  }
  return best;
}

/** Build the report from [{ id, name, project, self, findings }]. */
export function buildReport(containers) {
  const summary = { high: 0, medium: 0, low: 0 };
  const byCheck = new Map();

  for (const c of containers) {
    for (const f of c.findings) {
      if (!f.ignored) summary[f.severity] += 1;
      if (!byCheck.has(f.check)) {
        byCheck.set(f.check, { check: f.check, ...CHECKS[f.check], containers: [] });
      }
      byCheck.get(f.check).containers.push({ id: c.id, name: c.name, detail: f.detail, ignored: f.ignored });
    }
  }

  const checks = [...byCheck.values()]
    .map((c) => ({ ...c, open: c.containers.filter((x) => !x.ignored).length }))
    .sort((a, b) => RANK[b.severity] - RANK[a.severity] || b.open - a.open);

  return {
    summary,
    checks,
    containers: containers
      .map((c) => ({ id: c.id, name: c.name, project: c.project, risk: riskOf(c.findings), findings: c.findings }))
      .sort((a, b) => (RANK[b.risk] || 0) - (RANK[a.risk] || 0) || a.name.localeCompare(b.name)),
  };
}

/** Daemon-level findings from `docker info`. */
export function daemonReport(info) {
  const opts = info.SecurityOptions || [];
  const has = (n) => opts.some((o) => o.includes(`name=${n}`));
  const findings = [];
  if (!has('seccomp')) {
    findings.push({
      severity: 'medium', title: 'seccomp is not active on the Docker daemon',
      fix: 'Enable the default seccomp profile in the daemon configuration.',
    });
  }
  return {
    version: info.ServerVersion,
    storageDriver: info.Driver,
    cgroup: info.CgroupVersion ? `v${info.CgroupVersion}` : null,
    seccomp: has('seccomp'),
    apparmor: has('apparmor'),
    rootless: has('rootless'),
    userns: has('userns'),
    liveRestore: Boolean(info.LiveRestoreEnabled),
    findings,
  };
}
