import type { ActivityLogEntry } from '@bluelamp/core';

function icon(status: ActivityLogEntry['status']) {
  switch (status) {
    case 'done':
      return '✓';
    case 'skipped':
      return '⊘';
    case 'failed':
      return '✗';
  }
}

function formatTime(iso: string) {
  try {
    return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  } catch {
    return '';
  }
}

interface ActivityLogProps {
  entries: ActivityLogEntry[];
}

export function ActivityLog({ entries }: ActivityLogProps) {
  return (
    <div className="activity-log">
      <div className="activity-log-header">Activity Log</div>
      <div className="activity-log-body">
        {entries.length === 0 ? (
          <div className="activity-log-empty">Import a folder to see progress here.</div>
        ) : (
          entries.map((e) => (
            <div key={e.id} className={`activity-log-line status-${e.status}`}>
              <span className="activity-log-icon">{icon(e.status)}</span>
              <span className="activity-log-path">{e.relativePath}</span>
              <span className="activity-log-summary">— {e.summary}</span>
              <span className="activity-log-time">{formatTime(e.timestamp)}</span>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
