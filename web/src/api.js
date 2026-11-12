export class UnauthorizedError extends Error {}

async function request(path, options = {}) {
  const res = await fetch(`/api${path}`, {
    credentials: 'same-origin',
    headers: options.body ? { 'Content-Type': 'application/json' } : undefined,
    ...options,
  });
  if (res.status === 401 && path !== '/login') throw new UnauthorizedError();
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `request failed (${res.status})`);
  }
  return res;
}

const json = async (path, options) => (await request(path, options)).json();

export const api = {
  me: () => json('/me'),
  login: (password) => json('/login', { method: 'POST', body: JSON.stringify({ password }) }),
  logout: () => json('/logout', { method: 'POST' }),
  containers: () => json('/containers'),
  stats: () => json('/stats'),
  system: () => json('/system'),
  containerAction: (id, action) => json(`/containers/${id}/${action}`, { method: 'POST' }),
  setAutoStart: (id, enabled) =>
    json(`/containers/${id}/autostart`, { method: 'POST', body: JSON.stringify({ enabled }) }),
  cleanupPreview: () => json('/cleanup/preview'),
  cleanup: (selection) => json('/cleanup', { method: 'POST', body: JSON.stringify(selection) }),
  rebuild: (name, pull) =>
    json(`/projects/${encodeURIComponent(name)}/rebuild`, { method: 'POST', body: JSON.stringify({ pull }) }),
  job: (id) => json(`/jobs/${id}`),
  securityChecks: () => json('/security/checks'),
  securityStatus: () => json('/security/status'),
  securityImages: () => json('/security/images'),
  securityImage: (id) => json(`/security/images/${encodeURIComponent(id)}`),
  securityScan: (body) => json('/security/scan', { method: 'POST', body: JSON.stringify(body) }),
  projectAction: (name, action) =>
    json(`/projects/${encodeURIComponent(name)}/${action}`, { method: 'POST' }),
  logs: async (id, tail = 200) => (await request(`/containers/${id}/logs?tail=${tail}`)).text(),
};

export const fmtBytes = (n) => {
  if (!n) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.min(Math.floor(Math.log(n) / Math.log(1024)), units.length - 1);
  return `${(n / 1024 ** i).toFixed(i ? 1 : 0)} ${units[i]}`;
};

export const ago = (ms) => {
  if (!ms) return 'never';
  const s = Math.max(0, Math.round((Date.now() - ms) / 1000));
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  return `${Math.floor(s / 86400)} d ago`;
};
