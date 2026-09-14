/**
 * Safe save: write `<file>.tmp`, keep one `<file>.bak` of the previous version, rename the temp file
 * over the original. The file system is injected so the same code runs in Node (CLI/tests) and in the
 * Tauri webview (`@tauri-apps/plugin-fs`).
 */

export interface FileSystemLike {
  readTextFile(path: string): Promise<string>;
  writeTextFile(path: string, contents: string): Promise<void>;
  exists(path: string): Promise<boolean>;
  copyFile(from: string, to: string): Promise<void>;
  rename(from: string, to: string): Promise<void>;
  remove(path: string): Promise<void>;
}

export const tmpPath = (path: string): string => `${path}.tmp`;
export const bakPath = (path: string): string => `${path}.bak`;

export interface SaveResult {
  path: string;
  backup: string | null;
}

export async function saveLbrSafely(fs: FileSystemLike, path: string, contents: string): Promise<SaveResult> {
  const tmp = tmpPath(path);
  const bak = bakPath(path);
  await fs.writeTextFile(tmp, contents);
  // Verify the temp file before touching the original.
  const check = await fs.readTextFile(tmp);
  if (check !== contents) {
    await fs.remove(tmp).catch(() => undefined);
    throw new Error(`Verification of ${tmp} failed; original left untouched`);
  }
  let backup: string | null = null;
  if (await fs.exists(path)) {
    if (await fs.exists(bak)) await fs.remove(bak);
    await fs.copyFile(path, bak);
    backup = bak;
    // Windows cannot rename over an existing file; the .bak copy above is the safety net.
    await fs.remove(path);
  }
  await fs.rename(tmp, path);
  return { path, backup };
}
