import crypto from 'node:crypto';

const COOKIE = 'captain_session';
const TTL_MS = 12 * 60 * 60 * 1000;
const MAX_ATTEMPTS = 5;
const WINDOW_MS = 15 * 60 * 1000;

const attempts = new Map();

const sign = (secret, value) =>
  crypto.createHmac('sha256', secret).update(value).digest('hex');

const safeEqual = (a, b) => {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  return ba.length === bb.length && crypto.timingSafeEqual(ba, bb);
};

const parseCookies = (header = '') =>
  Object.fromEntries(
    header.split(';').map((p) => p.trim().split('=')).filter(([k]) => k)
      .map(([k, ...v]) => [k, decodeURIComponent(v.join('='))]),
  );

export function createAuth({ password, secret, secureCookie }) {
  const makeToken = () => {
    const exp = String(Date.now() + TTL_MS);
    return `${exp}.${sign(secret, exp)}`;
  };

  const validToken = (token) => {
    if (!token) return false;
    const [exp, sig] = token.split('.');
    if (!exp || !sig || !safeEqual(sig, sign(secret, exp))) return false;
    return Number(exp) > Date.now();
  };

  const isAuthed = (req) => validToken(parseCookies(req.headers.cookie)[COOKIE]);

  const requireAuth = (req, res, next) =>
    isAuthed(req) ? next() : res.status(401).json({ error: 'unauthorized' });

  const setCookie = (res, value, maxAge) => {
    const flags = ['HttpOnly', 'SameSite=Strict', 'Path=/', `Max-Age=${maxAge}`];
    if (secureCookie) flags.push('Secure');
    res.setHeader('Set-Cookie', `${COOKIE}=${encodeURIComponent(value)}; ${flags.join('; ')}`);
  };

  const login = (req, res) => {
    const ip = req.ip;
    const now = Date.now();
    const rec = attempts.get(ip);
    if (rec && now - rec.first < WINDOW_MS && rec.count >= MAX_ATTEMPTS) {
      return res.status(429).json({ error: 'too many attempts, try again later' });
    }
    const supplied = String(req.body?.password ?? '');
    if (!safeEqual(sign(secret, supplied), sign(secret, password))) {
      const fresh = !rec || now - rec.first >= WINDOW_MS;
      attempts.set(ip, fresh ? { first: now, count: 1 } : { first: rec.first, count: rec.count + 1 });
      return res.status(401).json({ error: 'wrong password' });
    }
    attempts.delete(ip);
    setCookie(res, makeToken(), TTL_MS / 1000);
    res.json({ ok: true });
  };

  const logout = (_req, res) => {
    setCookie(res, '', 0);
    res.json({ ok: true });
  };

  return { requireAuth, isAuthed, login, logout };
}
