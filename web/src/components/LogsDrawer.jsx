import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../api.js';

export default function LogsDrawer({ container, onClose }) {
  const [text, setText] = useState('Loading…');
  const ref = useRef(null);

  const load = useCallback(async () => {
    try {
      setText((await api.logs(container.id, 200)) || '(no logs)');
    } catch (e) {
      setText(`Failed to load logs: ${e.message}`);
    }
  }, [container.id]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    if (ref.current) ref.current.scrollTop = ref.current.scrollHeight;
  }, [text]);
  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <aside className="drawer">
      <div className="drawer-head">
        <b>{container.name}</b>
        <span className="muted small">last 200 lines</span>
        <div className="actions">
          <button className="ghost" onClick={load}>Refresh</button>
          <button className="ghost" onClick={onClose}>Close</button>
        </div>
      </div>
      <pre ref={ref}>{text}</pre>
    </aside>
  );
}
