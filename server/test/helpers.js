import { createApp } from '../src/app.js';
import * as demo from '../src/demo.js';

export async function start(opts = {}) {
  const app = createApp({ password: 'correct-horse', secret: 's3cret', backend: demo, demo: true, ...opts });
  const server = await new Promise((resolve) => { const s = app.listen(0, () => resolve(s)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  let cookie = '';

  const call = async (path, { method = 'GET', body, auth = true } = {}) => {
    const res = await fetch(base + path, {
      method,
      headers: {
        ...(body ? { 'Content-Type': 'application/json' } : {}),
        ...(auth && cookie ? { Cookie: cookie } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    let json;
    try { json = JSON.parse(text); } catch { /* plain text */ }
    return { status: res.status, json, text, headers: res.headers };
  };

  const login = async (password = 'correct-horse') => {
    const r = await call('/api/login', { method: 'POST', body: { password }, auth: false });
    const set = r.headers.get('set-cookie');
    if (set) cookie = set.split(';')[0];
    return r;
  };

  return { base, call, login, close: () => new Promise((r) => server.close(r)) };
}
