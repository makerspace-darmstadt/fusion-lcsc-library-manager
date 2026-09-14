import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { parseComponent } from '../src/core/easyeda/parse.ts';
import type { PartModel } from '../src/core/easyeda/types.ts';

export const FIXTURE_DIR = join(import.meta.dirname, '..', 'fixtures', 'easyeda');

/** All committed part fixtures (`C<digits>.json`), sorted. */
export const FIXTURE_IDS: string[] = readdirSync(FIXTURE_DIR)
  .filter((f) => /^C\d+\.json$/.test(f))
  .map((f) => f.replace('.json', ''))
  .sort();

export function loadFixtureJson(name: string): unknown {
  return JSON.parse(readFileSync(join(FIXTURE_DIR, `${name}.json`), 'utf8')) as unknown;
}

export function loadModel(id: string): PartModel {
  return parseComponent(loadFixtureJson(id), id);
}
