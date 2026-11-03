import { useEffect, useRef, useState } from 'react';
import { api } from '../api.js';

export default function RebuildModal({ project, onClose }) {
  const [pull, setPull] = useState(false);
  const [jobId, setJobId] = useState(null);
  const [job, setJob] = useState(null);
  const [error, setError] = useState('');
  const term = useRef(null);

  const start = async () => {
    setError('');
    try {
      setJobId((await api.rebuild(project, pull)).jobId);
    } catch (e) {
      setError(e.message);
    }
  };

  useEffect(() => {
    if (!jobId) return undefined;
    let stop = false;
    const tick = async () => {
      try {
        const j = await api.job(jobId);
        if (stop) return;
        setJob(j);
        if (j.status === 'running') setTimeout(tick, 1000);
      } catch (e) {
        if (!stop) setError(e.message);
      }
    };
    tick();
    return () => { stop = true; };
  }, [jobId]);

  useEffect(() => {
    if (term.current) term.current.scrollTop = term.current.scrollHeight;
  }, [job?.output]);

  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const running = !job || job.status === 'running';

  return (
    <div className="modal-back" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" role="dialog" aria-label="Rebuild project">
        <div className="modal-head">
          <h2>Rebuild “{project}”</h2>
          <button className="ghost" onClick={onClose}>Close</button>
        </div>

        <div className="modal-body">
          {error && <p className="banner">{error}</p>}

          {!jobId && (
            <>
              <p className="muted">
                Runs <code>docker compose up -d --build</code> for this project. Images are rebuilt, and
                containers whose image or settings changed are recreated, which restarts them briefly.
                Volumes are kept.
              </p>
              <label className="opt">
                <input type="checkbox" checked={pull} onChange={() => setPull(!pull)} />
                <span>Pull newer images first<br /><span className="muted small">For services that use a published image instead of a build.</span></span>
              </label>
            </>
          )}

          {jobId && (
            <>
              <div className="status-line">
                {running && <span className="spinner" />}
                <b>
                  {!job || job.status === 'running' ? 'Rebuilding…' : job.status === 'done' ? 'Finished' : 'Failed'}
                </b>
                {job && job.steps > 1 && <span className="muted small">step {job.step} of {job.steps}</span>}
                {running && <span className="muted small">You can close this; it keeps running.</span>}
              </div>
              <pre className="term" ref={term}>{job?.output || 'Starting…'}</pre>
            </>
          )}
        </div>

        <div className="modal-foot">
          <span className="muted small">
            {job?.status === 'done' && 'Containers are refreshed when you close this.'}
            {job?.status === 'failed' && `Exit code ${job.exitCode}. See the output above.`}
          </span>
          {!jobId && <button onClick={start}>Start rebuild</button>}
        </div>
      </div>
    </div>
  );
}
