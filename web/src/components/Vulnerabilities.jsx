import { useCallback, useEffect, useMemo, useState } from 'react';
import { ago, api, fmtBytes } from '../api.js';
import { Chevron } from './Icons.jsx';

const SEV = ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW', 'UNKNOWN'];
const SHORT = { critical: 'C', high: 'H', medium: 'M', low: 'L' };
const busy = (i) => i.status === 'scanning' || i.status === 'queued';

function Counts({ counts }) {
  if (!counts) return <span className="muted">–</span>;
  return (
    <span className="counts">
      {Object.keys(SHORT).map((k) => (
        <span key={k} className={`cve-chip ${k} ${counts[k] ? '' : 'zero'}`} title={`${counts[k]} ${k}`}>
          {SHORT[k]} {counts[k]}
        </span>
      ))}
    </span>
  );
}

function CveTable({ imageId }) {
  const [detail, setDetail] = useState(null);
  const [error, setError] = useState('');
  const [fixable, setFixable] = useState(false);
  const [min, setMin] = useState('LOW');

  useEffect(() => {
    api.securityImage(imageId).then(setDetail).catch((e) => setError(e.message));
  }, [imageId]);

  const rows = useMemo(() => {
    if (!detail) return [];
    const limit = SEV.indexOf(min);
    return detail.vulns.filter((v) => SEV.indexOf(v.severity) <= limit && (!fixable || v.fixed));
  }, [detail, fixable, min]);

  if (error) return <p className="banner">{error}</p>;
  if (!detail) return <p className="muted">Loading…</p>;

  return (
    <div className="cve">
      <div className="cve-filters">
        <label className="opt inline">
          <input type="checkbox" checked={fixable} onChange={() => setFixable(!fixable)} /> Fixable only
        </label>
        <label className="inline">
          Minimum severity{' '}
          <select value={min} onChange={(e) => setMin(e.target.value)}>
            {['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'].map((s) => <option key={s} value={s}>{s.toLowerCase()}</option>)}
          </select>
        </label>
        <span className="muted small">
          {rows.length} shown{detail.total > detail.vulns.length && ` (the ${detail.vulns.length} most severe of ${detail.total} are stored)`}
        </span>
      </div>
      <div className="tbl-wrap">
        <table className="tbl">
          <thead><tr><th>CVE</th><th>Severity</th><th>Package</th><th>Installed</th><th>Fixed in</th><th>Summary</th></tr></thead>
          <tbody>
            {rows.slice(0, 200).map((v) => (
              <tr key={`${v.id}-${v.pkg}-${v.installed}`}>
                <td><a href={`https://avd.aquasec.com/nvd/${v.id.toLowerCase()}`} target="_blank" rel="noreferrer noopener">{v.id}</a></td>
                <td><span className={`sev ${v.severity === 'CRITICAL' ? 'high' : v.severity.toLowerCase()}`}>{v.severity.toLowerCase()}</span></td>
                <td>{v.pkg}</td>
                <td className="num">{v.installed}</td>
                <td className="num">{v.fixed || <span className="muted">no fix yet</span>}</td>
                <td className="muted">{v.title}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {rows.length > 200 && <p className="muted small">Showing the first 200 rows. Narrow the filters to see others.</p>}
    </div>
  );
}

export default function Vulnerabilities({ demo }) {
  const [images, setImages] = useState(null);
  const [status, setStatus] = useState(null);
  const [error, setError] = useState('');
  const [open, setOpen] = useState(null);

  const load = useCallback(async () => {
    try {
      const [i, s] = await Promise.all([api.securityImages(), api.securityStatus()]);
      setImages(i);
      setStatus(s);
      setError('');
    } catch (e) {
      setError(e.message);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const scanning = images?.some(busy);
  useEffect(() => {
    if (!scanning) return undefined;
    const t = setInterval(load, 1500);
    return () => clearInterval(t);
  }, [scanning, load]);

  const scan = async (body) => {
    try {
      await api.securityScan(body);
      await load();
    } catch (e) {
      setError(e.message);
    }
  };

  if (!images && !error) return <p className="muted">Loading…</p>;

  const available = status?.available !== false;
  const totals = (images || []).reduce((t, i) => {
    if (i.counts) for (const k of Object.keys(t)) t[k] += i.counts[k] || 0;
    return t;
  }, { critical: 0, high: 0, medium: 0, low: 0 });
  const scanned = (images || []).filter((i) => i.status === 'done').length;

  return (
    <>
      {demo && <p className="demo-hint wide">Demo data. These are illustrative results, not real findings.</p>}
      {error && <p className="banner">{error}</p>}
      {!available && (
        <p className="banner">The vulnerability scanner (trivy) isn't available in this image, so scanning is disabled.</p>
      )}

      <div className="cards">
        {Object.keys(SHORT).map((k) => (
          <div key={k} className={`card sev-card ${k === 'critical' ? 'high' : k}`}>
            <span className="label">{k}</span>
            <span className="value">{totals[k]}</span>
            <span className="hint">across {scanned} scanned {scanned === 1 ? 'image' : 'images'}</span>
          </div>
        ))}
      </div>

      <section className="panel">
        <div className="panel-head">
          <h2>Images in use</h2>
          <span className="muted small">
            {status?.version && `Trivy ${status.version}`}
            {status?.dbUpdatedAt && ` · database ${ago(Date.parse(status.dbUpdatedAt))}`}
          </span>
          <button disabled={!available || scanning} onClick={() => scan({ all: true })}>
            {scanning ? 'Scanning…' : 'Scan all'}
          </button>
        </div>

        {(images || []).map((i) => (
          <div key={i.imageId} className="img">
            <div className="img-row">
              <button className="ghost icon" aria-label="Show findings" disabled={i.status !== 'done'} onClick={() => setOpen(open === i.imageId ? null : i.imageId)}>
                <Chevron open={open === i.imageId} />
              </button>
              <div className="img-name">
                <b title={i.imageId}>{i.tags[0] || `${i.imageId.slice(7, 19)} (untagged)`}</b>
                {i.tags.length > 1 && <span className="tag">+{i.tags.length - 1}</span>}
                <div className="sub">
                  used by {i.containers.slice(0, 3).join(', ')}{i.containers.length > 3 && ` +${i.containers.length - 3}`} · {fmtBytes(i.size)}
                </div>
              </div>
              <div className="img-result">
                {i.status === 'done' && (
                  <>
                    <Counts counts={i.counts} />
                    <span className="muted small">{i.fixable} fixable · {ago(i.scannedAt)}</span>
                  </>
                )}
                {i.status === 'never' && <span className="muted">Not scanned</span>}
                {i.status === 'queued' && <span className="muted">Queued…</span>}
                {i.status === 'scanning' && (
                  <span className="status-line"><span className="spinner" />
                    {i.phase === 'updating-db' ? 'Updating vulnerability database…' : 'Scanning…'}
                  </span>
                )}
                {i.status === 'error' && <span className="err-text" title={i.error}>Scan failed: {i.error}</span>}
              </div>
              <button className="ghost" disabled={!available || busy(i)} onClick={() => scan({ imageId: i.imageId })}>
                {i.status === 'done' ? 'Rescan' : 'Scan'}
              </button>
            </div>
            {open === i.imageId && <CveTable imageId={i.imageId} />}
          </div>
        ))}
      </section>
    </>
  );
}
