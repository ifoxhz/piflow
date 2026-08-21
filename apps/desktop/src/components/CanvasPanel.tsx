import type {
  CanvasArtifact,
  CanvasKpisPayload,
  CanvasTablePayload,
} from '@bluelamp/core';

export type CanvasMode = 'hidden' | 'docked' | 'expanded';

type CanvasPanelProps = {
  mode: CanvasMode;
  artifacts: CanvasArtifact[];
  activeId: string | null;
  onSelect: (id: string) => void;
  onModeChange: (mode: CanvasMode) => void;
};

function cellText(value: unknown): string {
  if (value == null) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function isTablePayload(artifact: CanvasArtifact): artifact is CanvasArtifact & {
  payload: CanvasTablePayload;
} {
  return artifact.kind === 'table' && Array.isArray((artifact.payload as CanvasTablePayload).columns);
}

function isKpisPayload(artifact: CanvasArtifact): artifact is CanvasArtifact & {
  payload: CanvasKpisPayload;
} {
  return artifact.kind === 'kpis' && Array.isArray((artifact.payload as CanvasKpisPayload).items);
}

function TableView({ payload }: { payload: CanvasTablePayload }) {
  if (payload.columns.length === 0) {
    return <p className="piflow-canvas-empty">无列可显示</p>;
  }
  return (
    <div className="piflow-canvas-table-wrap">
      <table className="piflow-canvas-table">
        <thead>
          <tr>
            {payload.columns.map((col) => (
              <th key={col.key}>{col.label}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {payload.rows.length === 0 ? (
            <tr>
              <td colSpan={payload.columns.length}>无行</td>
            </tr>
          ) : (
            payload.rows.map((row, ri) => (
              <tr key={ri}>
                {payload.columns.map((col) => {
                  const text = cellText(row[col.key]);
                  return (
                    <td key={col.key} title={text}>
                      {text}
                    </td>
                  );
                })}
              </tr>
            ))
          )}
        </tbody>
      </table>
      {payload.truncated && typeof payload.total === 'number' && (
        <p className="piflow-canvas-trunc">共 {payload.total} 行，仅展示前 {payload.rows.length} 行</p>
      )}
    </div>
  );
}

function KpisView({ payload }: { payload: CanvasKpisPayload }) {
  if (payload.items.length === 0) {
    return <p className="piflow-canvas-empty">暂无指标</p>;
  }
  return (
    <div className="piflow-canvas-kpis">
      {payload.items.map((item, i) => (
        <div key={`${item.label}-${i}`} className="piflow-canvas-kpi">
          <div className="piflow-canvas-kpi-label">{item.label}</div>
          {item.value ? <div className="piflow-canvas-kpi-value">{item.value}</div> : null}
          {item.hint ? <div className="piflow-canvas-kpi-hint">{item.hint}</div> : null}
        </div>
      ))}
    </div>
  );
}

export function CanvasPanel({
  mode,
  artifacts,
  activeId,
  onSelect,
  onModeChange,
}: CanvasPanelProps) {
  if (mode === 'hidden') {
    if (artifacts.length === 0) return null;
    return (
      <button
        type="button"
        className="piflow-canvas-rail"
        title="打开画布"
        onClick={() => onModeChange('docked')}
      >
        画布
        {artifacts.length > 1 ? ` ${artifacts.length}` : ''}
      </button>
    );
  }

  const active = artifacts.find((a) => a.id === activeId) ?? artifacts[artifacts.length - 1];

  return (
    <aside className={`piflow-canvas is-${mode}`}>
      <header className="piflow-canvas-header">
        <div className="piflow-canvas-header-text">
          <h3>{active?.title ?? '画布'}</h3>
          {active?.headline ? <p>{active.headline}</p> : null}
        </div>
        <div className="piflow-canvas-actions">
          {mode === 'docked' ? (
            <button type="button" onClick={() => onModeChange('expanded')} title="展开">
              展开
            </button>
          ) : (
            <button type="button" onClick={() => onModeChange('docked')} title="停靠">
              停靠
            </button>
          )}
          <button type="button" onClick={() => onModeChange('hidden')} title="收起">
            收起
          </button>
        </div>
      </header>

      {artifacts.length > 1 && (
        <nav className="piflow-canvas-tabs">
          {artifacts.map((a) => (
            <button
              key={a.id}
              type="button"
              className={a.id === active?.id ? 'is-active' : ''}
              onClick={() => onSelect(a.id)}
            >
              {a.title}
            </button>
          ))}
        </nav>
      )}

      <div className="piflow-canvas-body">
        {!active ? (
          <p className="piflow-canvas-empty">暂无结果</p>
        ) : isTablePayload(active) ? (
          <TableView payload={active.payload} />
        ) : isKpisPayload(active) ? (
          <KpisView payload={active.payload} />
        ) : (
          <p className="piflow-canvas-empty">无法显示此结果</p>
        )}
      </div>
    </aside>
  );
}
