import { readFile } from 'node:fs/promises';
import path from 'node:path';

export async function parseNativeFile(filePath: string): Promise<string> {
  return readFile(filePath, 'utf-8');
}

export function titleFromPath(filePath: string): string {
  return path.basename(filePath);
}
