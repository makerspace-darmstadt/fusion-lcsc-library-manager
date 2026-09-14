import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { suggestCategory } from '../src/core/categories.ts';
import { convertPart } from '../src/core/eagle/convert.ts';
import { LbrError, parseLbr, serializeLbr, summariseDevicesets } from '../src/core/lbr/document.ts';
import { applyMerge, entryNames } from '../src/core/lbr/merge.ts';
import { applyRemoval, planRemoval } from '../src/core/lbr/remove.ts';
import { loadModel } from './helpers.ts';

const REFERENCE = readFileSync(join(import.meta.dirname, '..', 'fixtures', 'lbr', 'reference.lbr'), 'utf8');
const convert = (id: string) => convertPart(loadModel(id), suggestCategory(loadModel(id).info));

describe('remove deviceset', () => {
  it('removing an added part restores the reference file byte for byte', () => {
    const doc = parseLbr(REFERENCE);
    applyMerge(doc, convert('C14663'));
    expect(serializeLbr(doc)).not.toBe(REFERENCE);
    const plan = planRemoval(doc, 'CAP_CC0603KRX7R9BB104');
    expect(plan).toEqual({ devicesetName: 'CAP_CC0603KRX7R9BB104', orphanPackages: ['C0603'], orphanSymbols: ['CAP_CC0603KRX7R9BB104'] });
    const r = applyRemoval(doc, 'CAP_CC0603KRX7R9BB104');
    expect(r).toEqual({ removedDeviceset: 'CAP_CC0603KRX7R9BB104', removedPackages: ['C0603'], removedSymbols: ['CAP_CC0603KRX7R9BB104'] });
    expect(serializeLbr(doc)).toBe(REFERENCE);
  });

  it('keeps packages and symbols still used by another deviceset', () => {
    const doc = parseLbr(REFERENCE);
    applyMerge(doc, convert('C14663'));
    // second part sharing the C0603 package (identical → reused)
    const twin = { ...convert('C14663'), lcsc: 'C1', devicesetName: 'CAP_TWIN', symbolNames: ['CAP_TWIN'] };
    twin.symbolEls = [{ ...twin.symbolEls[0], attrs: { name: 'CAP_TWIN' } }];
    twin.devicesetEl = JSON.parse(JSON.stringify(twin.devicesetEl).replace(/CAP_CC0603KRX7R9BB104/g, 'CAP_TWIN').replace('"C14663"', '"C1"'));
    applyMerge(doc, twin);
    expect(entryNames(doc, 'packages')).toEqual(['C3131', 'C0603']);
    const plan = planRemoval(doc, 'CAP_TWIN');
    expect(plan.orphanPackages).toEqual([]);
    expect(plan.orphanSymbols).toEqual(['CAP_TWIN']);
    applyRemoval(doc, 'CAP_TWIN');
    expect(entryNames(doc, 'packages')).toEqual(['C3131', 'C0603']);
    expect(entryNames(doc, 'symbols')).toEqual(['C3131', 'FUSE', 'CAP_CC0603KRX7R9BB104']);
    expect(summariseDevicesets(doc).map((d) => d.name)).toEqual(['C3131', 'CAP_CC0603KRX7R9BB104']);
  });

  it('can keep orphans, removes multi-unit symbols, and refuses unknown names', () => {
    const doc = parseLbr(REFERENCE);
    applyMerge(doc, convert('C6961'));
    const kept = applyRemoval(doc, 'IC_TL072CDT', { removeOrphans: false });
    expect(kept).toEqual({ removedDeviceset: 'IC_TL072CDT', removedPackages: [], removedSymbols: [] });
    expect(entryNames(doc, 'symbols')).toContain('IC_TL072CDT_A');

    const doc2 = parseLbr(REFERENCE);
    applyMerge(doc2, convert('C6961'));
    const r = applyRemoval(doc2, 'IC_TL072CDT');
    expect(r.removedSymbols).toEqual(['IC_TL072CDT_A', 'IC_TL072CDT_B']);
    expect(serializeLbr(doc2)).toBe(REFERENCE);
    expect(() => planRemoval(doc2, 'NOPE')).toThrow(LbrError);
  });

  it('never removes a package referenced from packages3d, and removes the reference (SamacSys) part cleanly', () => {
    const withP3d = REFERENCE.replace(
      '</devicesets>\n</library>',
      '</devicesets>\n<packages3d>\n<package3d name="C3131" urn="urn:adsk.eagle:package:1/1" type="box">\n<packageinstances>\n<packageinstance name="C3131"/>\n</packageinstances>\n</package3d>\n</packages3d>\n</library>',
    );
    const doc = parseLbr(withP3d);
    const plan = planRemoval(doc, 'C3131');
    expect(plan.orphanPackages).toEqual([]); // C3131 package is referenced by packages3d
    expect(plan.orphanSymbols).toEqual(['FUSE']); // symbol C3131 is unused by any deviceset but not "ours"
    const r = applyRemoval(doc, 'C3131');
    expect(r.removedSymbols).toEqual(['FUSE']);
    const out = serializeLbr(doc);
    expect(out).toContain('<devicesets>\n</devicesets>');
    expect(out).toContain('<packages3d>');
    expect(out).toContain('<package name="C3131">');
    expect(parseLbr(out)).toBeTruthy();
  });
});
