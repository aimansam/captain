import { useCallback, useEffect, useMemo, useState } from 'react';
import { api, fmtBytes, UnauthorizedError } from './api.js';
import ProjectGroup from './components/ProjectGroup.jsx';
import LogsDrawer from './components/LogsDrawer.jsx';
import CleanupModal from './components/CleanupModal.jsx';
import RebuildModal from './components/RebuildModal.jsx';
import { Anchor, Broom, Search } from './components/Icons.jsx';

const POLL_MS = 3000;

function Login({ onDone, demo }) {
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');

  const submit = async (e) => {
    e.preventDefault();
    setError('');
    try {
      await api.login(password);
      onDone();
    } catch (err) {
      setError(err.message);
    }
  };

  return (
    <form className="login" onSubmit={submit}>
      <div className="logo"><Anchor /></div>
      <h1>Captain</h1>
      <p className="muted">Sign in to manage your containers</p>
      {demo && <p className="demo-hint">Demo mode with fake data. Password: <b>demo</b></p>}
      <input
        type="password"
        placeholder="Password"
        autoFocus
        value={password}
        onChange={(e) => setPassword(e.target.value)}
      />
      <button type="submit">Sign in</button>
      {error && <p className="error">{error}</p>}
    </form>
  );
}

function Dashboard({ onLogout, readOnly }) {
  const [containers, setContainers] = useState([]);
  const [stats, setStats] = useState({});
  const [system, setSystem] = useState(null);
  const [error, setError] = useState('');
  const [pending, setPending] = useState(new Set());
  const [logTarget, setLogTarget] = useState(null);
  const [showCleanup, setShowCleanup] = useState(false);
  const [rebuildProject, setRebuildProject] = useState(null);
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState('all');

  const refresh = useCallback(async () => {
    try {
      const [c, s, sys] = await Promise.all([api.containers(), api.stats(), api.system()]);
      setContainers(c);
      setStats(s);
      setSystem(sys);
      setError('');
    } catch (e) {
      if (e instanceof UnauthorizedError) onLogout();
      else setError(e.message);
    }
  }, [onLogout]);

  useEffect(() => {
    refresh();
    const t = setInterval(refresh, POLL_MS);
    return () => clearInterval(t);
  }, [refresh]);

  const run = async (key, fn, confirmMsg) => {
    if (confirmMsg && !window.confirm(confirmMsg)) return;
    setPending((p) => new Set(p).add(key));
    try {
      await fn();
    } catch (e) {
      if (e instanceof UnauthorizedError) return onLogout();
      setError(e.message);
    } finally {
      setPending((p) => {
        const n = new Set(p);
        n.delete(key);
        return n;
      });
      refresh();
    }
  };

  const groups = useMemo(() => {
    const map = new Map();
    const q = query.trim().toLowerCase();
    const visible = containers.filter((c) =>
      (filter === 'all' || (filter === 'running') === (c.state === 'running')) &&
      (!q || c.name.toLowerCase().includes(q) || c.image.toLowerCase().includes(q) ||
        (c.project || '').toLowerCase().includes(q)));
    for (const c of visible) {
      const key = c.project || 'standalone';
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(c);
    }
    return [...map.entries()].sort(([a], [b]) =>
      a === 'standalone' ? 1 : b === 'standalone' ? -1 : a.localeCompare(b));
  }, [containers, query, filter]);

  const totals = useMemo(() => {
    const vals = Object.values(stats);
    return {
      cpu: vals.reduce((n, s) => n + s.cpu, 0),
      mem: vals.reduce((n, s) => n + s.memUsed, 0),
    };
  }, [stats]);

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand"><Anchor /><h1>Captain</h1></div>
        {system && <span className="muted small">Docker {system.dockerVersion}</span>}
        <button className="ghost" onClick={async () => { await api.logout(); onLogout(); }}>Log out</button>
      </header>

      {system && (
        <div className="cards">
          <div className="card">
            <span className="label">Containers</span>
            <span className="value">{system.running}<small> / {system.containers}</small></span>
            <span className="hint">running</span>
          </div>
          <div className="card">
            <span className="label">CPU</span>
            <span className="value">{(totals.cpu / system.cpus).toFixed(1)}<small>%</small></span>
            <span className="hint">{system.cpus} cores</span>
          </div>
          <div className="card">
            <span className="label">Memory</span>
            <span className="value">{fmtBytes(totals.mem)}</span>
            <span className="hint">of {fmtBytes(system.memTotal)}</span>
          </div>
          {system.disk && (
            <div className="card">
              <span className="label">Disk</span>
              <span className="value">{fmtBytes(system.disk.images + system.disk.volumes)}</span>
              <span className="hint">images {fmtBytes(system.disk.images)} · volumes {fmtBytes(system.disk.volumes)}</span>
            </div>
          )}
        </div>
      )}

      <div className="toolbar">
        <label className="search">
          <Search />
          <input placeholder="Search name, image or project" value={query} onChange={(e) => setQuery(e.target.value)} />
        </label>
        <div className="seg">
          {['all', 'running', 'stopped'].map((f) => (
            <button key={f} className={filter === f ? 'active' : ''} onClick={() => setFilter(f)}>{f}</button>
          ))}
        </div>
        {!readOnly && <button className="ghost" onClick={() => setShowCleanup(true)}><Broom /> Cleanup</button>}
      </div>

      {error && <p className="banner">{error}</p>}

      {groups.map(([name, items]) => (
        <ProjectGroup
          key={name}
          name={name}
          isProject={name !== 'standalone'}
          readOnly={readOnly}
          containers={items}
          stats={stats}
          pending={pending}
          onRebuild={setRebuildProject}
          onProject={(action) =>
            run(`p:${name}`, () => api.projectAction(name, action),
              action === 'down' ? `Stop all running containers in "${name}"?` : null)}
          onAction={(c, action) =>
            run(c.id, () => api.containerAction(c.id, action),
              action === 'stop' ? `Stop ${c.name}?` : null)}
          onLogs={setLogTarget}
          onAutoStart={(c, enabled) =>
            run(c.id, () => api.setAutoStart(c.id, enabled))}
        />
      ))}

      {groups.length === 0 && containers.length > 0 && <p className="empty">No containers match.</p>}

      {rebuildProject && (
        <RebuildModal project={rebuildProject} onClose={() => { setRebuildProject(null); refresh(); }} />
      )}

      {showCleanup && <CleanupModal onClose={() => { setShowCleanup(false); refresh(); }} />}

      {logTarget && <LogsDrawer container={logTarget} onClose={() => setLogTarget(null)} />}
    </div>
  );
}

export default function App() {
  const [authed, setAuthed] = useState(null);
  const [meta, setMeta] = useState({ demo: false, readOnly: false });

  useEffect(() => {
    api.me()
      .then((r) => { setAuthed(r.authed); setMeta({ demo: !!r.demo, readOnly: !!r.readOnly }); })
      .catch(() => setAuthed(false));
  }, []);

  const onLogout = useCallback(() => setAuthed(false), []);

  if (authed === null) return null;
  return authed
    ? <Dashboard onLogout={onLogout} readOnly={meta.readOnly} />
    : <Login onDone={() => setAuthed(true)} demo={meta.demo} />;
}
