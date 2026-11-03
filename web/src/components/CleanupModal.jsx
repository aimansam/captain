import { useCallback, useEffect, useMemo, useState } from 'react';
import { api, fmtBytes } from '../api.js';

const ageLabel = (d) => (d === null ? 'never ran' : d < 1 ? 'stopped today' : `stopped ${Math.floor(d)}d ago`);

function Section({ title, hint, size, children, empty }) {
  return (
    <section className="cl-section">
      <div className="cl-title">
        <b>{title}</b>
        {size > 0 && <span className="pill">{fmtBytes(size)}</span>}
      </div>
      {hint && <p className="muted small">{hint}</p>}
      {empty ? <p className="muted small">Nothing to clean.</p> : children}
    </section>
  );
}

export default function CleanupModal({ onClose }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
  const [sel, setSel] = useState({
    containers: new Set(), images: false, networks: new Set(), volumes: new Set(), buildCache: false,
  });

  const load = useCallback(async () => {
    try {
      const d = await api.cleanupPreview();
      setData(d);
      setSel({
        containers: new Set(d.containers.filter((c) => c.stale).map((c) => c.id)),
        images: d.images.count > 0,
        networks: new Set(d.networks),
        volumes: new Set(),
        buildCache: d.buildCache.size > 0,
      });
      setError('');
    } catch (e) {
      setError(e.message);
    }
  }, []);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const toggle = (key, value) =>
    setSel((s) => {
      const next = new Set(s[key]);
      next.has(value) ? next.delete(value) : next.add(value);
      return { ...s, [key]: next };
    });

  const estimate = useMemo(() => {
    if (!data) return 0;
    return data.containers.filter((c) => sel.containers.has(c.id)).reduce((n, c) => n + c.size, 0)
      + (sel.images ? data.images.size : 0)
      + (sel.buildCache ? data.buildCache.size : 0)
      + data.volumes.filter((v) => sel.volumes.has(v.name)).reduce((n, v) => n + v.size, 0);
  }, [data, sel]);

  const count = sel.containers.size + sel.networks.size + sel.volumes.size
    + (sel.images ? 1 : 0) + (sel.buildCache ? 1 : 0);

  const run = async () => {
    const lines = [];
    if (sel.containers.size) lines.push(`${sel.containers.size} stopped container(s)`);
    if (sel.images) lines.push('dangling images');
    if (sel.networks.size) lines.push(`${sel.networks.size} network(s)`);
    if (sel.buildCache) lines.push('build cache');
    if (sel.volumes.size) lines.push(`${sel.volumes.size} volume(s), PERMANENTLY deleting their data`);
    if (!window.confirm(`Remove:\n• ${lines.join('\n• ')}\n\nThis cannot be undone.`)) return;

    setBusy(true);
    try {
      setResult(await api.cleanup({
        containers: [...sel.containers],
        images: sel.images,
        networks: [...sel.networks],
        volumes: [...sel.volumes],
        buildCache: sel.buildCache,
      }));
      await load();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  const nothing = data && !data.containers.length && !data.images.count && !data.networks.length
    && !data.volumes.length && !data.buildCache.size;

  return (
    <div className="modal-back" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" role="dialog" aria-label="Cleanup">
        <div className="modal-head">
          <h2>Clean up stale Docker data</h2>
          <button className="ghost" onClick={onClose}>Close</button>
        </div>

        <div className="modal-body">
          {error && <p className="banner">{error}</p>}
          {result && (
            <p className="banner ok-banner">
              Removed {result.removed.containers} container(s), {result.removed.images} image(s),{' '}
              {result.removed.networks} network(s), {result.removed.volumes} volume(s)
              {result.removed.buildCache ? ', build cache' : ''}. Reclaimed {fmtBytes(result.reclaimed)} from images and cache.
              {result.failed.length > 0 && ` ${result.failed.length} item(s) failed: ${result.failed.join('; ')}`}
            </p>
          )}
          {!data && !error && <p className="muted">Scanning…</p>}
          {nothing && <p className="empty">Everything is clean.</p>}

          {data && (
            <>
              <Section
                title="Stopped containers"
                hint={`Ones stopped ${data.staleDays}+ days are pre-selected. Their volumes are kept.`}
                empty={!data.containers.length}
              >
                {data.containers.map((c) => (
                  <label key={c.id} className="cl-item">
                    <input type="checkbox" checked={sel.containers.has(c.id)} onChange={() => toggle('containers', c.id)} />
                    <span className="cl-name">{c.name}{c.project && <span className="tag">{c.project}</span>}</span>
                    <span className="muted small">{ageLabel(c.ageDays)}</span>
                  </label>
                ))}
              </Section>

              <Section title="Dangling images" size={data.images.size}
                hint="Untagged layers left behind by rebuilds." empty={!data.images.count}>
                <label className="cl-item">
                  <input type="checkbox" checked={sel.images} onChange={() => setSel((s) => ({ ...s, images: !s.images }))} />
                  <span className="cl-name">{data.images.count} image(s)</span>
                </label>
              </Section>

              <Section title="Build cache" size={data.buildCache.size}
                hint="Safe to remove; the next image build will just be slower." empty={!data.buildCache.size}>
                <label className="cl-item">
                  <input type="checkbox" checked={sel.buildCache} onChange={() => setSel((s) => ({ ...s, buildCache: !s.buildCache }))} />
                  <span className="cl-name">{data.buildCache.count} cache entries</span>
                </label>
              </Section>

              <Section title="Unused networks" hint="Not attached to any container." empty={!data.networks.length}>
                {data.networks.map((n) => (
                  <label key={n} className="cl-item">
                    <input type="checkbox" checked={sel.networks.has(n)} onChange={() => toggle('networks', n)} />
                    <span className="cl-name">{n}</span>
                  </label>
                ))}
              </Section>

              <Section title="Unused volumes" empty={!data.volumes.length}
                hint="Not used by any container. Deleting a volume permanently destroys its data, so none are pre-selected.">
                {data.volumes.map((v) => (
                  <label key={v.name} className="cl-item">
                    <input type="checkbox" checked={sel.volumes.has(v.name)} onChange={() => toggle('volumes', v.name)} />
                    <span className="cl-name" title={v.name}>
                      {v.anonymous ? `${v.name.slice(0, 12)}…` : v.name}
                      <span className="tag">{v.anonymous ? 'anonymous' : 'named'}</span>
                    </span>
                    <span className="muted small">{fmtBytes(v.size)}</span>
                  </label>
                ))}
              </Section>
            </>
          )}
        </div>

        <div className="modal-foot">
          <span className="muted">{count ? `${count} selected · about ${fmtBytes(estimate)}` : 'Nothing selected'}</span>
          <button className="danger-btn" disabled={busy || !count} onClick={run}>
            {busy ? 'Cleaning…' : 'Clean up'}
          </button>
        </div>
      </div>
    </div>
  );
}
