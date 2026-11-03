import { useState } from 'react';
import ContainerRow from './ContainerRow.jsx';
import { Chevron, Layers, Play, Stop } from './Icons.jsx';

export default function ProjectGroup({
  name, isProject, readOnly, containers, stats, pending, onProject, onRebuild, onAction, onLogs, onAutoStart,
}) {
  const [open, setOpen] = useState(true);
  const running = containers.filter((c) => c.state === 'running').length;
  const busy = pending.has(`p:${name}`);
  const canRebuild = containers.some((c) => c.rebuildable) && !containers.some((c) => c.self);

  return (
    <section className="group">
      <div className="group-head" onClick={() => setOpen(!open)}>
        <Chevron open={open} />
        <h2>{name}</h2>
        <span className={`pill ${running === containers.length ? 'ok' : running ? 'warn' : ''}`}>
          {running}/{containers.length} running
        </span>
        {isProject && !readOnly && (
          <div className="actions" onClick={(e) => e.stopPropagation()}>
            {canRebuild && (
              <button className="ghost" disabled={busy} onClick={() => onRebuild(name)} title="Run docker compose up -d --build for this project">
                <Layers /> Rebuild
              </button>
            )}
            <button className="ok-btn" disabled={busy || running === containers.length} onClick={() => onProject('up')}>
              <Play /> Up
            </button>
            <button className="danger-btn" disabled={busy || running === 0} onClick={() => onProject('down')}>
              <Stop /> Down
            </button>
          </div>
        )}
      </div>
      {open && (
        <div className="rows">
          {containers.map((c) => (
            <ContainerRow
              key={c.id}
              c={c}
              stat={stats[c.id]}
              busy={busy || pending.has(c.id)}
              onAction={onAction}
              onLogs={onLogs}
              onAutoStart={onAutoStart}
              readOnly={readOnly}
            />
          ))}
        </div>
      )}
    </section>
  );
}
