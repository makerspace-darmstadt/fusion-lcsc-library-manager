import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { copyFile, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { suggestCategory } from '../src/core/categories.ts';
import { convertPart } from '../src/core/eagle/convert.ts';
import { el } from '../src/core/eagle/xml.ts';
import { containerElement, createEmptyLibrary, libraryElement, parseLbr, serializeLbr, summariseDevicesets, LbrError } from '../src/core/lbr/document.ts';
import { applyMerge, canonicalize, canonicalizeDocument, entryNames, MergeConflictError, planMerge } from '../src/core/lbr/merge.ts';
import { saveLbrSafely, type FileSystemLike } from '../src/core/lbr/save.ts';
import { loadModel } from './helpers.ts';

const REFERENCE = readFileSync(join(import.meta.dirname, '..', 'fixtures', 'lbr', 'reference.lbr'), 'utf8');
const convert = (id: string) => convertPart(loadModel(id), suggestCategory(loadModel(id).info));

describe('round-trip fidelity', () => {
  it('load + save of the reference library is byte-identical', () => {
    const doc = parseLbr(REFERENCE);
    expect(serializeLbr(doc)).toBe(REFERENCE);
  });

  it('is semantically identical after re-parsing (elements, attributes, order, text)', () => {
    const doc = parseLbr(REFERENCE);
    const again = parseLbr(serializeLbr(doc));
    expect(canonicalizeDocument(again)).toBe(canonicalizeDocument(doc));
    // the canonical form is insensitive to whitespace and number formatting only
    const a = parseLbr('<eagle><drawing><library><packages><package name="P">\n<smd name="1" x="0.70" y="-0" dx="1" dy="1" layer="1"/>\n</package></packages></library></drawing></eagle>');
    const b = parseLbr('<eagle><drawing><library><packages><package name="P"><smd dx="1" dy="1" layer="1" name="1" x="0.7" y="0"/></package></packages></library></drawing></eagle>');
    expect(canonicalizeDocument(a)).toBe(canonicalizeDocument(b));
    const c = parseLbr('<eagle><drawing><library><packages><package name="P"><smd dx="1" dy="1" layer="1" name="1" x="0.71" y="0"/></package></packages></library></drawing></eagle>');
    expect(canonicalizeDocument(c)).not.toBe(canonicalizeDocument(a));
  });

  it('rejects non-Eagle and malformed files', () => {
    expect(() => parseLbr('<html/>')).toThrow(LbrError);
    expect(() => parseLbr('<eagle><drawing>')).toThrow(LbrError);
    expect(() => parseLbr('not xml at all')).toThrow(LbrError);
  });
});

describe('canonicalize', () => {
  it('normalises attribute order, numbers and whitespace', () => {
    const doc = parseLbr('<eagle><drawing><library/></drawing></eagle>');
    const a = doc.createElement('x');
    a.setAttribute('b', '1.50');
    a.setAttribute('a', ' t ');
    a.appendChild(doc.createTextNode('\n  hello   world \n'));
    const b = doc.createElement('x');
    b.setAttribute('a', 't');
    b.setAttribute('b', '1.5');
    b.appendChild(doc.createTextNode('hello world'));
    expect(canonicalize(a)).toBe(canonicalize(b));
    expect(canonicalize(a)).toBe('<x a="t" b="1.5">#"hello world"</x>');
  });
});

describe('merge into the reference library', () => {
  it('appends new package/symbol/deviceset and leaves everything else byte-identical', () => {
    const doc = parseLbr(REFERENCE);
    const part = convert('C14663');
    const plan = planMerge(doc, part);
    expect(plan).toMatchObject({
      alreadyPresentAs: null,
      packages: [{ kind: 'package', name: 'C0603', status: 'new' }],
      symbols: [{ kind: 'symbol', name: 'CAP_CC0603KRX7R9BB104', status: 'new' }],
      devicesetRenamedTo: null,
      conflicts: [],
    });
    const result = applyMerge(doc, part);
    expect(result).toMatchObject({ skipped: false, addedPackages: ['C0603'], addedSymbols: ['CAP_CC0603KRX7R9BB104'], devicesetName: 'CAP_CC0603KRX7R9BB104', reused: [], renamed: {} });
    const out = serializeLbr(doc);
    // everything before the first appended element is unchanged, and the tail of the file too
    const cut = REFERENCE.indexOf('</package>\n</packages>') + '</package>\n'.length;
    expect(out.startsWith(REFERENCE.slice(0, cut))).toBe(true);
    expect(out.endsWith('</deviceset>\n</devicesets>\n</library>\n</drawing>\n</eagle>\n')).toBe(true);
    expect(entryNames(doc, 'packages')).toEqual(['C3131', 'C0603']);
    expect(entryNames(doc, 'symbols')).toEqual(['C3131', 'FUSE', 'CAP_CC0603KRX7R9BB104']);
    expect(entryNames(doc, 'devicesets')).toEqual(['C3131', 'CAP_CC0603KRX7R9BB104']);
    // and the result is a well-formed library whose settings/layers are untouched
    const again = parseLbr(out);
    expect(again.getElementsByTagName('layer')).toHaveLength(REFERENCE.match(/<layer /g)!.length);
    expect(summariseDevicesets(again).map((d) => [d.name, d.packages, d.lcsc])).toEqual([
      ['C3131', ['C3131'], []],
      ['CAP_CC0603KRX7R9BB104', ['C0603'], ['C14663']],
    ]);
  });

  it('skips a part whose LCSC number is already in the library', () => {
    const doc = parseLbr(REFERENCE);
    const part = convert('C14663');
    applyMerge(doc, part);
    const before = serializeLbr(doc);
    const plan = planMerge(doc, part);
    expect(plan.alreadyPresentAs).toBe('CAP_CC0603KRX7R9BB104');
    const result = applyMerge(doc, part);
    expect(result.skipped).toBe(true);
    expect(serializeLbr(doc)).toBe(before);
  });

  it('reuses an identical package (two 0603 capacitors share C0603)', () => {
    const doc = parseLbr(REFERENCE);
    applyMerge(doc, convert('C14663'));
    const r = convert('C25804'); // R0603, different package name → new
    expect(planMerge(doc, r).packages[0].status).toBe('new');
    // simulate a second part with the identical C0603 package
    const twin = { ...convert('C14663'), lcsc: 'C9999999', devicesetName: 'CAP_TWIN', symbolNames: ['CAP_TWIN'] };
    twin.symbolEls = [{ ...twin.symbolEls[0], attrs: { name: 'CAP_TWIN' } }];
    twin.devicesetEl = el('deviceset', { name: 'CAP_TWIN', prefix: 'C' }, [
      el('gates', {}, [el('gate', { name: 'G$1', symbol: 'CAP_TWIN', x: 0, y: 0 })]),
      el('devices', {}, [el('device', { name: '', package: 'C0603' }, [el('technologies', {}, [el('technology', { name: '' }, [el('attribute', { name: 'LCSC', value: 'C9999999', constant: 'no' })])])])]),
    ]);
    const plan = planMerge(doc, twin);
    expect(plan.packages[0].status).toBe('identical');
    expect(plan.conflicts).toEqual([]);
    const result = applyMerge(doc, twin);
    expect(result.reused).toEqual(['package C0603']);
    expect(result.addedPackages).toEqual([]);
    expect(entryNames(doc, 'packages')).toEqual(['C3131', 'C0603']);
  });

  it('detects a differing package with the same name and requires a resolution', () => {
    const doc = parseLbr(REFERENCE);
    // reference.lbr already has a package named C3131 (SamacSys) with different geometry
    const part = { ...convert('C14663') };
    part.packageName = 'C3131';
    part.packageEl = { ...part.packageEl, attrs: { name: 'C3131' } };
    part.devicesetEl = JSON.parse(JSON.stringify(part.devicesetEl).replace('"package":"C0603"', '"package":"C3131"'));
    const plan = planMerge(doc, part);
    expect(plan.conflicts).toEqual([{ kind: 'package', name: 'C3131', status: 'conflict' }]);
    expect(() => applyMerge(doc, part)).toThrow(MergeConflictError);

    // rename → imported as C3131_2 and the device retargeted
    const renamed = applyMerge(parseLbr(REFERENCE), part, { resolutions: { 'package:C3131': 'rename' } });
    expect(renamed.renamed).toEqual({ C3131: 'C3131_2' });
    expect(renamed.addedPackages).toEqual(['C3131_2']);

    const doc2 = parseLbr(REFERENCE);
    applyMerge(doc2, part, { resolutions: { 'package:C3131': 'rename' } });
    const text = serializeLbr(doc2);
    expect(text).toContain('<package name="C3131_2">');
    expect(text).toContain('<device name="" package="C3131_2">');

    // reuse → nothing added, device points at the existing package
    const doc3 = parseLbr(REFERENCE);
    const reused = applyMerge(doc3, part, { resolutions: { 'package:C3131': 'reuse' } });
    expect(reused.reused).toEqual(['package C3131']);
    expect(serializeLbr(doc3)).toContain('<device name="" package="C3131">');
    expect(entryNames(doc3, 'packages')).toEqual(['C3131']);
  });

  it('renames a symbol conflict and retargets the gate', () => {
    const doc = parseLbr(REFERENCE);
    const part = { ...convert('C14663') };
    part.symbolNames = ['FUSE'];
    part.symbolEls = [{ ...part.symbolEls[0], attrs: { name: 'FUSE' } }];
    part.devicesetEl = JSON.parse(JSON.stringify(part.devicesetEl).replace('"symbol":"CAP_CC0603KRX7R9BB104"', '"symbol":"FUSE"'));
    expect(planMerge(doc, part).conflicts).toEqual([{ kind: 'symbol', name: 'FUSE', status: 'conflict' }]);
    applyMerge(doc, part, { resolutions: { 'symbol:FUSE': 'rename' } });
    const text = serializeLbr(doc);
    expect(text).toContain('<symbol name="FUSE_2">');
    expect(text).toContain('<gate name="G$1" symbol="FUSE_2" x="0" y="0"/>');
  });

  it('renames the deviceset when the name is taken by a different part', () => {
    const doc = parseLbr(REFERENCE);
    const part = { ...convert('C14663'), devicesetName: 'C3131' };
    part.devicesetEl = { ...part.devicesetEl, attrs: { ...part.devicesetEl.attrs, name: 'C3131' } };
    const plan = planMerge(doc, part);
    expect(plan.devicesetRenamedTo).toBe('C3131_2');
    const r = applyMerge(doc, part);
    expect(r.devicesetName).toBe('C3131_2');
    expect(entryNames(doc, 'devicesets')).toEqual(['C3131', 'C3131_2']);
  });

  it('creates missing containers in the order packages, symbols, devicesets', () => {
    const doc = parseLbr('<?xml version="1.0" encoding="utf-8"?>\n<!DOCTYPE eagle SYSTEM "eagle.dtd">\n<eagle version="9.7.0">\n<drawing>\n<settings>\n</settings>\n<layers>\n</layers>\n<library>\n<description>x</description>\n<packages3d>\n</packages3d>\n</library>\n</drawing>\n</eagle>\n');
    applyMerge(doc, convert('C14663'));
    const lib = libraryElement(doc);
    const order = Array.from({ length: lib.childNodes.length }, (_, i) => lib.childNodes[i]).filter((n) => n.nodeType === 1).map((n) => (n as unknown as { tagName: string }).tagName);
    expect(order).toEqual(['description', 'packages', 'symbols', 'devicesets', 'packages3d']);
    expect(containerElement(doc, 'packages')?.getElementsByTagName('package')).toHaveLength(1);
    const text = serializeLbr(doc);
    expect(text).toContain('<packages3d>\n</packages3d>');
    expect(text.startsWith('<?xml version="1.0" encoding="utf-8"?>\n<!DOCTYPE eagle SYSTEM "eagle.dtd">\n<eagle version="9.7.0">\n<drawing>\n<settings>\n</settings>\n<layers>\n</layers>\n<library>\n<description>x</description>\n<packages>\n<package name="C0603">')).toBe(true);
  });

  it('createEmptyLibrary keeps settings/grid/layers and starts with empty containers', () => {
    const doc = createEmptyLibrary(REFERENCE, 'My parts');
    const text = serializeLbr(doc);
    expect(text).toContain('<grid distance="0.1"');
    expect(text).toContain('<layer number="1" name="Top"');
    expect(text).toContain('<library>\n<description>My parts</description>\n<packages>\n</packages>\n<symbols>\n</symbols>\n<devicesets>\n</devicesets>\n</library>');
    expect(text).not.toContain('FUSE');
  });

  it('multi-unit parts merge two symbols', () => {
    const doc = parseLbr(REFERENCE);
    const r = applyMerge(doc, convert('C6961'));
    expect(r.addedSymbols).toEqual(['IC_TL072CDT_A', 'IC_TL072CDT_B']);
  });
});

describe('saveLbrSafely', () => {
  let dir: string;
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
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'lbr-save-'));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('writes a new file without a backup', async () => {
    const p = join(dir, 'new.lbr');
    const r = await saveLbrSafely(nodeFs, p, 'v1');
    expect(r).toEqual({ path: p, backup: null });
    expect(readFileSync(p, 'utf8')).toBe('v1');
    expect(await nodeFs.exists(`${p}.tmp`)).toBe(false);
  });

  it('keeps exactly one .bak of the previous version', async () => {
    const p = join(dir, 'lib.lbr');
    await saveLbrSafely(nodeFs, p, 'v1');
    await saveLbrSafely(nodeFs, p, 'v2');
    expect(readFileSync(p, 'utf8')).toBe('v2');
    expect(readFileSync(`${p}.bak`, 'utf8')).toBe('v1');
    await saveLbrSafely(nodeFs, p, 'v3');
    expect(readFileSync(p, 'utf8')).toBe('v3');
    expect(readFileSync(`${p}.bak`, 'utf8')).toBe('v2');
    expect(await nodeFs.exists(`${p}.tmp`)).toBe(false);
  });

  it('leaves the original untouched when the temp file cannot be verified', async () => {
    const p = join(dir, 'lib.lbr');
    await writeFile(p, 'original');
    const broken: FileSystemLike = { ...nodeFs, readTextFile: async () => 'corrupted' };
    await expect(saveLbrSafely(broken, p, 'v2')).rejects.toThrow(/Verification/);
    expect(readFileSync(p, 'utf8')).toBe('original');
    expect(await nodeFs.exists(`${p}.bak`)).toBe(false);
  });
});
