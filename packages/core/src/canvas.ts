export type CanvasKind = 'table' | 'kpis';

export type CanvasArtifactStatus = 'streaming' | 'ready';

export type CanvasTableColumn = {
  key: string;
  label: string;
};

export type CanvasTablePayload = {
  columns: CanvasTableColumn[];
  rows: Array<Record<string, unknown>>;
  total?: number;
  truncated?: boolean;
};

export type CanvasKpiItem = {
  label: string;
  value: string;
  hint?: string;
};

export type CanvasKpisPayload = {
  items: CanvasKpiItem[];
};

export type CanvasPayload = CanvasTablePayload | CanvasKpisPayload;

export type CanvasArtifact = {
  id: string;
  revision: number;
  kind: CanvasKind;
  title: string;
  headline: string;
  outline: string[];
  status: CanvasArtifactStatus;
  sourceTool: string;
  payload: CanvasPayload;
};
