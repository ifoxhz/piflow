import type { CanvasArtifact } from '@bluelamp/core';

type SummaryCardProps = {
  artifact: CanvasArtifact;
  extraCount?: number;
  onOpen: () => void;
};

export function SummaryCard({ artifact, extraCount = 0, onOpen }: SummaryCardProps) {
  const bullets = artifact.outline.slice(0, 7);
  return (
    <div className="piflow-summary-card">
      <div className="piflow-summary-headline">{artifact.headline || artifact.title}</div>
      {bullets.length > 0 && (
        <ul className="piflow-summary-outline">
          {bullets.map((line, i) => (
            <li key={`${i}-${line.slice(0, 24)}`}>{line}</li>
          ))}
        </ul>
      )}
      <button type="button" className="piflow-summary-cta" onClick={onOpen}>
        打开画布
        {extraCount > 0 ? ` · ${extraCount + 1} 个结果` : ''}
      </button>
    </div>
  );
}
