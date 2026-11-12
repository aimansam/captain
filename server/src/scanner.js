import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const IMAGE_ID_RE = /^sha256:[0-9a-f]{64}$/;
const SEVERITY_RANK = { CRITICAL: 5, HIGH: 4, MEDIUM: 3, LOW: 2, UNKNOWN: 1 };
const MAX_VULNS = 500;
const MAX_STDOUT = 64 * 1024 * 1024;
const TIMEOUT_MS = 15 * 60 * 1000;

export const validImageId = (id) => typeof id === 'string' && IMAGE_ID_RE.test(id);

const emptyCounts = () => ({ critical: 0, high: 0, medium: 0, low: 0, unknown: 0 });

/** Turn Trivy's JSON report into counts plus a capped, severity-sorted list. */
export function parseTrivy(report) {
  const seen = new Set();
  const vulns = [];
  for (const result of report?.Results || []) {
    for (const v of result.Vulnerabilities || []) {
      const key = `${v.VulnerabilityID}|${v.PkgName}|${v.InstalledVersion}`;
      if (seen.has(key)) continue;
      seen.add(key);
      vulns.push({
        id: v.VulnerabilityID,
        pkg: v.PkgName,
        installed: v.InstalledVersion || '',
        fixed: v.FixedVersion || '',
        severity: SEVERITY_RANK[v.Severity] ? v.Severity : 'UNKNOWN',
        title: v.Title || '',
      });
    }
  }
  const counts = emptyCounts();
  for (const v of vulns) counts[v.severity.toLowerCase()] += 1;
  vulns.sort((a, b) =>
    SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity] || Number(Boolean(b.fixed)) - Number(Boolean(a.fixed)));
  return {
    counts,
    total: vulns.length,
    fixable: vulns.filter((v) => v.fixed).length,
    vulns: vulns.slice(0, MAX_VULNS),
  };
}

// Prefer Trivy's own FATAL/ERROR line, without its timestamp and level prefix.
export function cleanError(stderr) {
  const lines = stderr.trim().split('\n').filter(Boolean);
  const hit = [...lines].reverse().find((l) => /\t(FATAL|ERROR)\t/.test(l) || /\s(FATAL|ERROR)\s/.test(l));
  const line = hit || lines.slice(-1)[0] || '';
  return line.replace(/^\S+\s+(FATAL|ERROR)\s+(Fatal error\s+)?/, '').replace(/^run error:\s*/, '').trim();
}

const defaultArgs = (imageId) =>
  ['image', '--format', 'json', '--scanners', 'vuln', '--no-progress', '--image-src', 'docker', imageId];

// Minimal environment: nothing from Captain's own configuration reaches the scanner.
const scanEnv = (dataDir) => ({
  PATH: process.env.PATH,
  HOME: '/tmp',
  DOCKER_HOST: `unix://${process.env.DOCKER_SOCKET || '/var/run/docker.sock'}`,
  TRIVY_CACHE_DIR: path.join(dataDir, 'trivy'),
  ...(process.env.TRIVY_DB_REPOSITORY ? { TRIVY_DB_REPOSITORY: process.env.TRIVY_DB_REPOSITORY } : {}),
  ...(process.env.TRIVY_JAVA_DB_REPOSITORY ? { TRIVY_JAVA_DB_REPOSITORY: process.env.TRIVY_JAVA_DB_REPOSITORY } : {}),
});

export function createScanner({
  bin = 'trivy',
  buildArgs = defaultArgs,
  dataDir = process.env.DATA_DIR || '/data',
  timeoutMs = TIMEOUT_MS,
} = {}) {
  const resultsFile = path.join(dataDir, 'scan-results.json');
  const results = new Map();
  const queue = [];
  let running = false;
  let infoCache = null;

  try {
    const saved = JSON.parse(fs.readFileSync(resultsFile, 'utf8'));
    for (const r of saved) if (validImageId(r.imageId)) results.set(r.imageId, r);
  } catch { /* no saved results yet */ }

  const persist = () => {
    try {
      fs.mkdirSync(dataDir, { recursive: true });
      const done = [...results.values()].filter((r) => r.status === 'done' || r.status === 'error');
      fs.writeFileSync(`${resultsFile}.tmp`, JSON.stringify(done));
      fs.renameSync(`${resultsFile}.tmp`, resultsFile);
    } catch { /* read-only or missing volume: results stay in memory */ }
  };

  const run = (imageId) => new Promise((resolve) => {
    const entry = results.get(imageId);
    let out = '';
    let err = '';
    let overflow = false;
    const child = spawn(bin, buildArgs(imageId), { env: scanEnv(dataDir), stdio: ['ignore', 'pipe', 'pipe'] });
    const timer = setTimeout(() => { err += '\nscan timed out'; child.kill('SIGKILL'); }, timeoutMs);

    child.stdout.on('data', (d) => {
      entry.phase = 'scanning';
      if (out.length + d.length > MAX_STDOUT) { overflow = true; return; }
      out += d;
    });
    child.stderr.on('data', (d) => {
      err = (err + d).slice(-4000);
      if (/vulnerability db|db update|downloading/i.test(String(d))) entry.phase = 'updating-db';
    });
    child.on('error', (e) => { clearTimeout(timer); resolve({ error: `could not start ${bin}: ${e.message}` }); });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code !== 0) {
        return resolve({ error: cleanError(err) || `scanner exited with code ${code}` });
      }
      if (overflow) return resolve({ error: 'scanner output too large' });
      try {
        resolve({ report: parseTrivy(JSON.parse(out)) });
      } catch {
        resolve({ error: 'could not read scanner output' });
      }
    });
  });

  const pump = async () => {
    if (running) return;
    running = true;
    while (queue.length) {
      const imageId = queue.shift();
      const entry = results.get(imageId);
      entry.status = 'scanning';
      entry.phase = 'scanning';
      const { report, error } = await run(imageId);
      entry.phase = null;
      entry.scannedAt = Date.now();
      if (error) {
        Object.assign(entry, { status: 'error', error });
      } else {
        Object.assign(entry, report, { status: 'done', error: null });
      }
      persist();
    }
    running = false;
  };

  return {
    /** Queue one image. Returns false if it is already queued or scanning. */
    scan(imageId) {
      if (!validImageId(imageId)) throw Object.assign(new Error('bad image id'), { status: 400 });
      const current = results.get(imageId);
      if (current && (current.status === 'queued' || current.status === 'scanning')) return false;
      results.set(imageId, {
        ...(current || {}), imageId, status: 'queued', phase: null, error: null,
      });
      queue.push(imageId);
      pump();
      return true;
    },
    summary(imageId) {
      const { vulns, ...rest } = results.get(imageId) || { status: 'never' };
      return rest;
    },
    detail: (imageId) => results.get(imageId) || null,
    forget(validIds) {
      for (const id of results.keys()) if (!validIds.has(id) && !queue.includes(id)) results.delete(id);
    },
    busy: () => ({ queued: queue.length, scanning: running }),
    idle: async () => { while (running || queue.length) await new Promise((r) => setTimeout(r, 20)); },

    /** Trivy version and vulnerability DB date, or { available: false }. */
    async info() {
      if (infoCache && Date.now() - infoCache.at < 60_000) return infoCache.value;
      const value = await new Promise((resolve) => {
        let out = '';
        const child = spawn(bin, ['--version'], { env: scanEnv(dataDir), stdio: ['ignore', 'pipe', 'ignore'] });
        child.stdout.on('data', (d) => { out += d; });
        child.on('error', () => resolve({ available: false }));
        child.on('close', (code) => {
          if (code !== 0) return resolve({ available: false });
          resolve({
            available: true,
            version: /Version:\s*(\S+)/.exec(out)?.[1] || null,
            dbUpdatedAt: /UpdatedAt:\s*(\S+)/.exec(out)?.[1] || null,
          });
        });
      });
      infoCache = { at: Date.now(), value };
      return value;
    },
  };
}
