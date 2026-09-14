#!/usr/bin/env node
/**
 * Dev CLI: fetch an LCSC part from EasyEDA and print the intermediate model as JSON.
 *
 *   npm run convert -- C3131                 # model JSON to stdout, warnings to stderr
 *   npm run convert -- C3131 --out part.json # write the model to a file
 *   npm run convert -- --fixture fixtures/easyeda/C3131.json  # offline, from a committed fixture
 */

import { readFile, writeFile } from 'node:fs/promises';
import { EasyEdaClient } from '../src/core/easyeda/fetch.ts';
import { parseComponent } from '../src/core/easyeda/parse.ts';
import { EasyEdaError, normaliseLcscId } from '../src/core/easyeda/errors.ts';
import type { PartModel } from '../src/core/easyeda/types.ts';
import type { ConversionWarning } from '../src/core/warnings.ts';

interface Args {
  id?: string;
  out?: string;
  fixture?: string;
  help: boolean;
}

function parseArgs(argv: string[]): Args {
  const a: Args = { help: false };
  for (let i = 0; i < argv.length; i++) {
    const t = argv[i];
    if (t === '--out') a.out = argv[++i];
    else if (t === '--fixture') a.fixture = argv[++i];
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
    process.stderr.write('Usage: npm run convert -- <LCSC id> [--out file.json] [--fixture path.json]\n');
    return args.help ? 0 : 2;
  }
  const model = await loadModel(args);
  printWarnings(model.warnings);
  const text = JSON.stringify(model, null, 2);
  if (args.out) {
    await writeFile(args.out, text);
    process.stderr.write(`Wrote ${args.out}\n`);
  } else {
    process.stdout.write(text + '\n');
  }
  return model.warnings.some((w) => w.severity === 'error') ? 1 : 0;
}

main()
  .then((code) => process.exit(code))
  .catch((e: unknown) => {
    if (e instanceof EasyEdaError) process.stderr.write(`ERROR (${e.code}): ${e.message}\n`);
    else process.stderr.write(`ERROR: ${(e as Error).stack ?? String(e)}\n`);
    process.exit(1);
  });
