import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const NAME_RE = /^[a-z0-9][a-z0-9_-]*$/;
const MAX_OUTPUT = 200_000;
const MAX_JOBS = 20;
const TIMEOUT_MS = 30 * 60 * 1000;

const jobs = new Map();

const err = (status, message) => Object.assign(new Error(message), { status });

export const validProjectName = (name) => NAME_RE.test(name);

// Compose records where a project was started from in container labels.
export function composeSpec(labels = {}) {
  const dir = labels['com.docker.compose.project.working_dir'];
  const files = (labels['com.docker.compose.project.config_files'] || '').split(',').filter(Boolean);
  if (!dir || !files.length || !path.isAbsolute(dir)) return null;
  if (!files.every((f) => path.isAbsolute(f) && /\.ya?ml$/.test(f))) return null;
  return { dir, files };
}

export const isRebuildable = (spec) =>
  Boolean(spec) && fs.existsSync(spec.dir) && spec.files.every((f) => fs.existsSync(f));

export function commandsFor(project, spec, { pull = false } = {}) {
  const base = ['compose', '-p', project, '--project-directory', spec.dir, ...spec.files.flatMap((f) => ['-f', f])];
  const cmds = [];
  if (pull) cmds.push([...base, 'pull', '--ignore-buildable']);
  cmds.push([...base, 'up', '-d', '--build']);
  return cmds;
}

// Child processes get a minimal environment so Captain's own secrets never reach a build.
const childEnv = () => ({
  PATH: process.env.PATH,
  HOME: '/tmp',
  DOCKER_HOST: `unix://${process.env.DOCKER_SOCKET || '/var/run/docker.sock'}`,
  NO_COLOR: '1',
  COMPOSE_ANSI: 'never',
  COMPOSE_PROGRESS: 'plain',
});

const quote = (a) => (/[\s"']/.test(a) ? JSON.stringify(a) : a);

function run(bin, args, append) {
  return new Promise((resolve) => {
    const child = spawn(bin, args, { env: childEnv(), stdio: ['ignore', 'pipe', 'pipe'] });
    const timer = setTimeout(() => {
      append('\n[timed out after 30 minutes, stopping]\n');
      child.kill('SIGKILL');
    }, TIMEOUT_MS);
    child.stdout.on('data', (d) => append(d.toString()));
    child.stderr.on('data', (d) => append(d.toString()));
    child.on('error', (e) => {
      clearTimeout(timer);
      append(`failed to start ${bin}: ${e.message}\n`);
      resolve(127);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve(code ?? 1);
    });
  });
}

export function startJob(project, cmds, { bin = 'docker' } = {}) {
  if ([...jobs.values()].some((j) => j.project === project && j.status === 'running')) {
    throw err(409, `a rebuild of "${project}" is already running`);
  }
  const job = {
    id: crypto.randomUUID(), project, status: 'running', exitCode: null,
    output: '', step: 0, steps: cmds.length, startedAt: Date.now(), endedAt: null,
  };
  jobs.set(job.id, job);
  while (jobs.size > MAX_JOBS) jobs.delete(jobs.keys().next().value);

  const append = (s) => { job.output = (job.output + s).slice(-MAX_OUTPUT); };
  (async () => {
    for (const [i, args] of cmds.entries()) {
      job.step = i + 1;
      append(`$ ${bin} ${args.map(quote).join(' ')}\n`);
      const code = await run(bin, args, append);
      if (code !== 0) {
        append(`\n[exited with code ${code}]\n`);
        Object.assign(job, { status: 'failed', exitCode: code, endedAt: Date.now() });
        return;
      }
    }
    Object.assign(job, { status: 'done', exitCode: 0, endedAt: Date.now() });
  })();
  return { jobId: job.id };
}

export function getJob(id) {
  const job = jobs.get(id);
  if (!job) throw err(404, 'no such job');
  return { ...job };
}
