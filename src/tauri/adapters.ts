/** Thin adapters from Tauri plugins to the pure-core interfaces. Only this folder imports Tauri. */

import { open as openDialog, save as saveDialog } from '@tauri-apps/plugin-dialog';
import { copyFile, exists, readTextFile, remove, rename, writeTextFile } from '@tauri-apps/plugin-fs';
import { fetch as tauriFetch } from '@tauri-apps/plugin-http';
import { openUrl } from '@tauri-apps/plugin-opener';
import { EasyEdaClient } from '../core/easyeda/fetch.ts';
import type { FileSystemLike } from '../core/lbr/save.ts';

export const easyEda = new EasyEdaClient((url, init) => tauriFetch(url, init));

export const tauriFs: FileSystemLike = {
  readTextFile: (p) => readTextFile(p),
  writeTextFile: (p, c) => writeTextFile(p, c),
  exists: (p) => exists(p),
  copyFile: (a, b) => copyFile(a, b),
  rename: (a, b) => rename(a, b),
  remove: (p) => remove(p),
};

const LBR_FILTER = [{ name: 'Fusion / Eagle library', extensions: ['lbr'] }];

export async function pickLibraryToOpen(defaultPath?: string): Promise<string | null> {
  const r = await openDialog({ multiple: false, directory: false, filters: LBR_FILTER, defaultPath, title: 'Open library' });
  return typeof r === 'string' ? r : null;
}

export async function pickLibraryToCreate(defaultPath?: string): Promise<string | null> {
  const r = await saveDialog({ filters: LBR_FILTER, defaultPath: defaultPath ?? 'lcsc-parts.lbr', title: 'Create new library' });
  return r ?? null;
}

export function openExternal(url: string): void {
  void openUrl(url);
}
