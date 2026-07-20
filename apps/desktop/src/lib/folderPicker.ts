import { isTauri } from '@tauri-apps/api/core';
import { open } from '@tauri-apps/plugin-dialog';

/** True when running inside the Tauri desktop shell (not plain browser dev). */
export function canPickFolder(): boolean {
  return isTauri();
}

/** Open the OS folder picker. Returns null if cancelled or unavailable. */
export async function pickImportFolder(defaultPath?: string): Promise<string | null> {
  if (!isTauri()) return null;

  const selected = await open({
    directory: true,
    multiple: false,
    recursive: true,
    title: '选择要导入的文件夹',
    defaultPath: defaultPath?.trim() || undefined,
  });

  if (typeof selected === 'string' && selected.trim()) {
    return selected;
  }
  return null;
}
