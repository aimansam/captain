import { useCallback, useEffect, useState } from 'react';
import { api } from '../api.js';
import { Chevron } from './Icons.jsx';

const SEVERITY_LABEL = { high: 'High', medium: 'Medium', low: 'Low' };

// Render `inline code` in the catalog text.
const Text = ({ children }) => String(children).split('`').map((part, i) => (i % 2 ? <code key={i}>{part}</code> : part));

function CheckRow({ check, filter }) {
  const [open, setOpen] = useState(false);
  const q = filter.trim().toLowerCase();
  const items = check.containers.filter((c) => !q || c.name.toLowerCase().includes(q));
  if (!items.length) return null;
  const openCount = items.filter((c) => !c.ignored).length;

  return (
    <div className="check">
      <div className="check-head" onClick={() => setOpen(!open)}>
        <Chevron open={open} />
        <span className={`sev ${check.severity}`}>{SEVERITY_LABEL[check.severity]}</span>
        <b>{check.title}</b>
        <span className="muted small">
          {openCount} {openCount === 1 ? 'container' : 'containers'}
          {items.length > openCount && `, ${items.length - openCount} accepted`}
        </span>
      </div>
      {open && (
        <div className="check-body">
          <p><span className="muted">Why it matters:</span> <Text>{check.why}</Text></p>
          <p><span className="muted">How to fix:</span> <Text>{check.fix}</Text></p>
          <div className="check-containers">
            {items.map((c) => (
              <span key={c.id} className={`chip ${c.ignored ? 'accepted' : ''}`} title={c.ignored ? 'Accepted via captain.security.ignore' : undefined}>
                {c.name}{c.detail && <span className="muted"> · {c.detail}</span>}{c.ignored && ' · accepted'}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export default function ConfigChecks({ filter, onFilter }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    try {
      setData(await api.securityChecks());
      setError('');
    } catch (e) {
      setError(e.message);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  if (error) return <p className="banner">{error}</p>;
  if (!data) return <p className="muted">Checking your containers…</p>;

  const accepted = data.checks.reduce((n, c) => n + c.containers.length - c.open, 0);
  const d = data.daemon;

  return (
    <>
      <div className="cards">
        {['high', 'medium', 'low'].map((s) => (
          <div key={s} className={`card sev-card ${s}`}>
            <span className="label">{SEVERITY_LABEL[s]}</span>
            <span className="value">{data.summary[s]}</span>
            <span className="hint">open findings</span>
          </div>
        ))}
        <div className="card">
          <span className="label">Accepted</span>
          <span className="value">{accepted}</span>
          <span className="hint">via the ignore label</span>
        </div>
      </div>

      <section className="panel">
        <div className="panel-head">
          <h2>Docker daemon</h2>
          <span className="muted small">Docker {d.version}</span>
        </div>
        <div className="chips">
          <span className={`chip ${d.seccomp ? 'good' : 'bad'}`}>seccomp {d.seccomp ? 'on' : 'off'}</span>
          <span className={`chip ${d.apparmor ? 'good' : ''}`}>AppArmor {d.apparmor ? 'on' : 'off'}</span>
          <span className={`chip ${d.rootless ? 'good' : ''}`}>{d.rootless ? 'rootless' : 'runs as root'}</span>
          <span className="chip">{d.storageDriver}</span>
          {d.cgroup && <span className="chip">cgroup {d.cgroup}</span>}
        </div>
        {d.findings.map((f) => (
          <p key={f.title} className="banner">{f.title}. <Text>{f.fix}</Text></p>
        ))}
      </section>

      <section className="panel">
        <div className="panel-head">
          <h2>Container checks</h2>
          <input className="mini-search" placeholder="Filter by container" value={filter} onChange={(e) => onFilter(e.target.value)} />
          <button className="ghost" onClick={load}>Re-check</button>
        </div>
        {data.checks.length === 0 && <p className="empty">No findings. Nice.</p>}
        {data.checks.map((c) => <CheckRow key={c.check} check={c} filter={filter} />)}
      </section>
    </>
  );
}
