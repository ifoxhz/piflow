type BootstrapScreenProps = {
  error?: string | null;
  elapsedSec?: number;
  detail?: string | null;
};

/** Full-window wait UI while sidecar extracts / starts (first launch). */
export function BootstrapScreen({ error, elapsedSec = 0, detail }: BootstrapScreenProps) {
  return (
    <div className="bootstrap-screen" role="status" aria-live="polite">
      <div className="bootstrap-card">
        <div className="bootstrap-brand">piFlow</div>
        {error ? (
          <>
            <p className="bootstrap-title">环境准备失败</p>
            <p className="bootstrap-title-en">Environment setup failed</p>
            <p className="bootstrap-error">{error}</p>
            <p className="bootstrap-hint">
              请确认便携包完整，删除 %APPDATA%\piFlow\sidecar 后重试，或查看 logs\rag-server.log
            </p>
            <p className="bootstrap-hint-en">
              Ensure the portable folder is complete, delete %APPDATA%\piFlow\sidecar, then retry.
            </p>
          </>
        ) : (
          <>
            <div className="bootstrap-spinner" aria-hidden />
            <p className="bootstrap-title">正在准备环境，请稍等…</p>
            <p className="bootstrap-title-en">Preparing environment, please wait…</p>
            {detail && <p className="bootstrap-detail">{detail}</p>}
            <p className="bootstrap-detail">
              首次启动可能需要解压后端与初始化数据库
              {elapsedSec > 0 ? `（已等待 ${elapsedSec} 秒）` : ''}
            </p>
            <p className="bootstrap-detail-en">
              First launch may extract the backend and initialize the database
              {elapsedSec > 0 ? ` (${elapsedSec}s elapsed)` : ''}
            </p>
          </>
        )}
      </div>
    </div>
  );
}
