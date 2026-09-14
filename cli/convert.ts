#!/usr/bin/env node
/**
 * Dev CLI.
 *
 *   npm run convert -- C3131                       # model JSON to stdout, warnings to stderr
 *   npm run convert -- C3131 --out part.json       # write the model to a file
 *   npm run convert -- C3131 --xml                 # print the Eagle fragments (package/symbol/deviceset)
 *   npm run convert -- C3131 --lbr new.lbr         # write a standalone library (skeleton: fixtures/lbr/reference.lbr)
 *   npm run convert -- C3131 --category resistor   # override the auto-suggested category
 *   npm run convert -- C3131 --into my.lbr         # merge into an existing library (.bak kept)
 *   npm run convert -- C3131 --into my.lbr --on-conflict rename|reuse
 *   npm run convert -- --fixture fixtures/easyeda/C3131.json …   # offline, from a committed fixture
 */

import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DEFAULT_CATEGORIES, suggestCategory } from '../src/core/categories.ts';
import { convertPart, fragmentsToString } from '../src/core/eagle/convert.ts';
import { EasyEdaError, normaliseLcscId } from '../src/core/easyeda/errors.ts';
import { EasyEdaClient } from '../src/core/easyeda/fetch.ts';
import { parseComponent } from '../src/core/easyeda/parse.ts';
import type { PartModel } from '../src/core/easyeda/types.ts';
import { parseLbr, serializeLbr } from '../src/core/lbr/document.ts';
import { applyMerge, planMerge, type Resolution } from '../src/core/lbr/merge.ts';
import { saveLbrSafely, type FileSystemLike } from '../src/core/lbr/save.ts';
import { buildStandaloneLbr } from '../src/core/lbr/standalone.ts';
import { copyFile, rename, rm, stat } from 'node:fs/promises';
import type { ConversionWarning } from '../src/core/warnings.ts';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
export const REFERENCE_LBR = join(ROOT, 'fixtures', 'lbr', 'reference.lbr');

interface Args {
  id?: string;
  out?: string;
  fixture?: string;
  xml: boolean;
  lbr?: string;
  into?: string;
  onConflict?: Resolution;
  category?: string;
  help: boolean;
}

const nodeFs: FileSystemLike = {
  readTextFile: (p) => readFile(p, 'utf8'),
  writeTextFile: (p, c) => writeFile(p, c),
  exists: (p) =>
    stat(p).then(
      () => true,
      () => false,
    ),
  copyFile: (a, b) => copyFile(a, b),
  rename: (a, b) => rename(a, b),
  remove: (p) => rm(p),
};

function parseArgs(argv: string[]): Args {
  const a: Args = { help: false, xml: false };
  for (let i = 0; i < argv.length; i++) {
    const t = argv[i];
    if (t === '--out') a.out = argv[++i];
    else if (t === '--fixture') a.fixture = argv[++i];
    else if (t === '--xml') a.xml = true;
    else if (t === '--lbr') a.lbr = argv[++i];
    else if (t === '--into') a.into = argv[++i];
    else if (t === '--on-conflict') {
      const v = argv[++i];
      if (v !== 'rename' && v !== 'reuse') throw new Error('--on-conflict expects rename or reuse');
      a.onConflict = v;
    }
    else if (t === '--category') a.category = argv[++i];
    else if (t === '--help' || t === '-h') a.help = true;
    else if (t.startsWith('--')) throw new Error(`Unknown option ${t}`);
    else a.id = t;
  }
  return a;
}

function printWarnings(warnings: ConversionWarning[]): void {
  for (const w of warnings) {
    const tag = w.severity.toUpperCase().padEnd(7);
    process.stderr.write(`${tag} ${w.code}: ${w.message}${w.raw ? `\n        raw: ${w.raw.slice(0, 120)}` : ''}\n`);
  }
}

async function loadModel(args: Args): Promise<PartModel> {
  if (args.fixture) {
    const json = JSON.parse(await readFile(args.fixture, 'utf8')) as unknown;
    const idFromName = /(C\d+)/.exec(args.fixture)?.[1] ?? args.id ?? 'FIXTURE';
    return parseComponent(json, idFromName);
  }
  if (!args.id) throw new Error('Missing LCSC part number (e.g. C3131)');
  const client = new EasyEdaClient((url, init) => fetch(url, init));
  return client.fetchPart(normaliseLcscId(args.id));
}

async function main(): Promise<number> {
  const args = parseArgs(process.argv.slice(2));
  if (args.help || (!args.id && !args.fixture)) {
    process.stderr.write('Usage: npm run convert -- <LCSC id> [--out model.json] [--xml] [--lbr new.lbr] [--into existing.lbr [--on-conflict rename|reuse]] [--category id] [--fixture path.json]\n');
    return args.help ? 0 : 2;
  }
  const model = await loadModel(args);
  if (!args.xml && !args.lbr && !args.into) {
    printWarnings(model.warnings);
    const text = JSON.stringify(model, null, 2);
    if (args.out) {
      await writeFile(args.out, text);
      process.stderr.write(`Wrote ${args.out}\n`);
    } else process.stdout.write(text + '\n');
    return model.warnings.some((w) => w.severity === 'error') ? 1 : 0;
  }

  const wanted = args.category?.toLowerCase();
  const category = wanted ? DEFAULT_CATEGORIES.find((c) => c.id === wanted) : suggestCategory(model.info);
  if (!category) throw new Error(`Unknown category "${args.category}". Known: ${DEFAULT_CATEGORIES.map((c) => c.id).join(', ')}`);
  process.stderr.write(`Category: ${category.name}\n`);
  const converted = convertPart(model, category);
  printWarnings(converted.warnings);
  if (args.xml) process.stdout.write(fragmentsToString(converted));
  if (args.lbr) {
    if (converted.hasErrors) {
      process.stderr.write('Conversion has errors; not writing the library.\n');
      return 1;
    }
    const reference = await readFile(REFERENCE_LBR, 'utf8');
    await writeFile(args.lbr, buildStandaloneLbr(reference, [converted]));
    process.stderr.write(`Wrote ${args.lbr} (${converted.devicesetName}, package ${converted.packageName})\n`);
  }
  if (args.into) {
    if (converted.hasErrors) {
      process.stderr.write('Conversion has errors; not merging.\n');
      return 1;
    }
    const doc = parseLbr(await readFile(args.into, 'utf8'));
    const plan = planMerge(doc, converted);
    if (plan.alreadyPresentAs) {
      process.stderr.write(`${converted.lcsc} is already in ${args.into} as deviceset ${plan.alreadyPresentAs}; nothing to do.\n`);
      return 0;
    }
    if (plan.conflicts.length && !args.onConflict) {
      for (const c of plan.conflicts) process.stderr.write(`CONFLICT ${c.kind} "${c.name}" exists with different content\n`);
      process.stderr.write('Re-run with --on-conflict rename (import as NAME_2) or --on-conflict reuse (keep the existing one).\n');
      return 3;
    }
    const resolutions: Record<string, Resolution> = {};
    for (const c of plan.conflicts) resolutions[`${c.kind}:${c.name}`] = args.onConflict!;
    const result = applyMerge(doc, converted, { resolutions });
    const saved = await saveLbrSafely(nodeFs, args.into, serializeLbr(doc));
    process.stderr.write(
      `Merged ${converted.lcsc} into ${saved.path} as ${result.devicesetName}` +
        (result.addedPackages.length ? `; packages added: ${result.addedPackages.join(', ')}` : '') +
        (result.addedSymbols.length ? `; symbols added: ${result.addedSymbols.join(', ')}` : '') +
        (result.reused.length ? `; reused: ${result.reused.join(', ')}` : '') +
        (Object.keys(result.renamed).length ? `; renamed: ${JSON.stringify(result.renamed)}` : '') +
        (saved.backup ? `; backup: ${saved.backup}` : '') +
        '\n',
    );
  }
  return converted.hasErrors ? 1 : 0;
}

main()
  .then((code) => process.exit(code))
  .catch((e: unknown) => {
    if (e instanceof EasyEdaError) process.stderr.write(`ERROR (${e.code}): ${e.message}\n`);
    else process.stderr.write(`ERROR: ${(e as Error).stack ?? String(e)}\n`);
    process.exit(1);
  });
