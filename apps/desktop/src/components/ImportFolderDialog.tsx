import { useState } from 'react';
import { canPickFolder, pickImportFolder } from '../lib/folderPicker';

interface ImportFolderDialogProps {
  open: boolean;
  path: string;
  onPathChange: (path: string) => void;
  onClose: () => void;
  onConfirm: () => void;
  importing: boolean;
}

export function ImportFolderDialog({
  open,
  path,
  onPathChange,
  onClose,
  onConfirm,
  importing,
}: ImportFolderDialogProps) {
  const [pickError, setPickError] = useState<string | null>(null);
  const nativePicker = canPickFolder();

  if (!open) return null;

  const handleBrowse = async () => {
    setPickError(null);
    try {
      const selected = await pickImportFolder(path);
      if (selected) onPathChange(selected);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setPickError(msg);
    }
  };

  return (
    <div className="dialog-overlay" onClick={onClose} role="presentation">
      <div className="dialog-card" onClick={(e) => e.stopPropagation()} role="dialog">
        <h3>Import folder</h3>
        {nativePicker ? (
          <p className="dialog-hint">
            点击「选择文件夹」打开系统目录对话框，或手动粘贴路径。导入将在{' '}
            <code>rag-server</code> 所在机器上读取该目录。
          </p>
        ) : (
          <p className="dialog-hint">
            输入 <code>rag-server</code> 可访问的绝对路径。WSL 示例：{' '}
            <code>/mnt/c/Users/you/Documents/papers</code>
          </p>
        )}
        <div className="dialog-path-row">
          <input
            type="text"
            className="dialog-input"
            value={path}
            onChange={(e) => onPathChange(e.target.value)}
            placeholder={
              nativePicker ? 'C:\\Users\\you\\Documents\\papers' : '/mnt/c/Users/you/Documents/papers'
            }
            disabled={importing}
          />
          {nativePicker && (
            <button
              type="button"
              className="btn-secondary dialog-browse"
              onClick={handleBrowse}
              disabled={importing}
            >
              选择文件夹
            </button>
          )}
        </div>
        {pickError && <div className="dialog-error">{pickError}</div>}
        <div className="dialog-actions">
          <button type="button" className="btn-secondary" onClick={onClose} disabled={importing}>
            Cancel
          </button>
          <button
            type="button"
            className="btn-primary"
            onClick={onConfirm}
            disabled={importing || !path.trim()}
          >
            {importing ? 'Importing…' : 'Start import'}
          </button>
        </div>
      </div>
    </div>
  );
}
