import type { HealthResponse } from '@bluelamp/core';

interface SettingsViewProps {
  health: HealthResponse | null;
  healthError: string | null;
}

export function SettingsView({ health, healthError }: SettingsViewProps) {
  return (
    <div className="placeholder-view settings-view">
      <h2>Settings</h2>

      <section className="settings-section">
        <h3>RAG Server</h3>
        {healthError && <p className="status-error">{healthError}</p>}
        {health && (
          <ul className="model-status-list">
            <li>
              Status: <strong>{health.status}</strong>
            </li>
            {health.models?.map((m) => (
              <li key={m.id}>
                {m.id}: <strong>{m.status}</strong>
                {m.missingFiles && m.missingFiles.length > 0 && (
                  <span className="missing-files"> — missing {m.missingFiles.join(', ')}</span>
                )}
              </li>
            ))}
          </ul>
        )}
        {!health && !healthError && <p>Checking server...</p>}
        <p className="settings-hint">
          Run <code>pnpm dev:server</code> and <code>pnpm models:ensure</code> to download models
          via hf-mirror.com.
        </p>
      </section>
    </div>
  );
}
