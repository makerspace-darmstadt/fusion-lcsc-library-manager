/** Persistent settings via @tauri-apps/plugin-store. */

import { load, type Store } from '@tauri-apps/plugin-store';
import { DEFAULT_CATEGORIES, type Category } from '../core/categories.ts';

export interface Settings {
  lbrPath: string | null;
  categories: Category[];
}

const FILE = 'settings.json';
let storePromise: Promise<Store> | null = null;

function store(): Promise<Store> {
  if (!storePromise) storePromise = load(FILE, { autoSave: true, defaults: {} });
  return storePromise;
}

function validCategories(v: unknown): Category[] | null {
  if (!Array.isArray(v) || v.length === 0) return null;
  const ok = v.every(
    (c) => c && typeof c === 'object' && typeof c.id === 'string' && typeof c.name === 'string' && typeof c.devicesetPrefix === 'string' && typeof c.designator === 'string' && typeof c.keywords === 'string',
  );
  return ok ? (v as Category[]) : null;
}

export async function loadSettings(): Promise<Settings> {
  try {
    const s = await store();
    const lbrPath = (await s.get<string>('lbrPath')) ?? null;
    const categories = validCategories(await s.get<unknown>('categories')) ?? DEFAULT_CATEGORIES;
    return { lbrPath, categories };
  } catch {
    return { lbrPath: null, categories: DEFAULT_CATEGORIES };
  }
}

export async function saveSettings(patch: Partial<Settings>): Promise<void> {
  const s = await store();
  if (patch.lbrPath !== undefined) await s.set('lbrPath', patch.lbrPath);
  if (patch.categories !== undefined) await s.set('categories', patch.categories);
  await s.save();
}
