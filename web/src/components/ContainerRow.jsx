import { fmtBytes } from '../api.js';
import { Logs, Play, Restart, Stop } from './Icons.jsx';

export default function ContainerRow({ c, stat, busy, onAction, onLogs, onAutoStart, readOnly }) {
  const autoStart = c.restart !== 'no';
  const running = c.state === 'running';
  const live = running && stat;
  const memPct = live && stat.memLimit ? Math.min((stat.memUsed / stat.memLimit) * 100, 100) : 0;
  const cpuPct = live ? Math.min(stat.cpu, 100) : 0;

  return (
    <div className={`row ${busy ? 'busy' : ''}`}>
      <div className="cell name">
        <span className={`dot ${c.state}`} title={c.state} />
        <div className="name-text">
          <div className="title">
            {c.name}
            {c.self && <span className="tag">this app</span>}
          </div>
          <div className="sub" title={c.image}>
            {c.image}
            {c.ports.length > 0 && <span className="ports"> · :{c.ports.join(' :')}</span>}
          </div>
        </div>
      </div>

      <div className="cell status"><span className={`badge ${c.state}`}>{c.status}</span></div>

      <div className="cell meter" data-label="CPU">
        <span className="num">{live ? `${stat.cpu.toFixed(1)}%` : '—'}</span>
        <div className="bar"><div style={{ width: `${cpuPct}%` }} /></div>
      </div>

      <div className="cell meter" data-label="Memory">
        <span className="num">{live ? fmtBytes(stat.memUsed) : '—'}</span>
        <div className="bar"><div style={{ width: `${memPct}%` }} /></div>
      </div>

      <div className="cell net" data-label="Network">
        {live ? (
          <>
            <span>↓ {fmtBytes(stat.netRx)}</span>
            <span>↑ {fmtBytes(stat.netTx)}</span>
          </>
        ) : '—'}
      </div>

      <div className="cell auto" data-label="Auto-start">
        <button
          role="switch"
          aria-checked={autoStart}
          className={`switch ${autoStart ? 'on' : ''}`}
          title={autoStart
            ? `Starts automatically after reboot (${c.restart}). Click to turn off.`
            : 'Will stay stopped after reboot. Click to start automatically.'}
          disabled={busy || readOnly}
          onClick={() => onAutoStart(c, !autoStart)}
        />
      </div>

      <div className="cell actions">
        {readOnly ? null : running ? (
          <>
            <button className="icon" title="Restart" disabled={busy || c.self} onClick={() => onAction(c, 'restart')}><Restart /></button>
            <button className="icon danger" title="Stop" disabled={busy || c.self} onClick={() => onAction(c, 'stop')}><Stop /></button>
          </>
        ) : (
          <button className="icon ok" title="Start" disabled={busy} onClick={() => onAction(c, 'start')}><Play /></button>
        )}
        <button className="icon" title="Logs" onClick={() => onLogs(c)}><Logs /></button>
      </div>
    </div>
  );
}
