/**
 * Golden tests: one expected XML per fixture, reviewed by hand once, then frozen.
 * Regenerate deliberately with `UPDATE_GOLDEN=1 npm test`.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { suggestCategory } from '../src/core/categories.ts';
import { convertPart, fragmentsToString } from '../src/core/eagle/convert.ts';
import { buildStandaloneLbr } from '../src/core/lbr/standalone.ts';
import { parseLbr } from '../src/core/lbr/document.ts';
import { FIXTURE_IDS, loadModel } from './helpers.ts';

const GOLDEN_DIR = join(import.meta.dirname, 'golden');
const REFERENCE = readFileSync(join(import.meta.dirname, '..', 'fixtures', 'lbr', 'reference.lbr'), 'utf8');
const UPDATE = process.env.UPDATE_GOLDEN === '1';

describe('golden Eagle fragments', () => {
  it.each(FIXTURE_IDS)('%s matches tests/golden/%s.xml', (id) => {
    const model = loadModel(id);
    const converted = convertPart(model, suggestCategory(model.info));
    const warningLines = converted.warnings.map((w) => `<!-- ${w.severity} ${w.code}: ${w.message.replace(/--/g, '−−')} -->`).join('\n');
    const actual = `${warningLines}\n${fragmentsToString(converted)}`;
    const file = join(GOLDEN_DIR, `${id}.xml`);
    if (UPDATE || !existsSync(file)) {
      mkdirSync(GOLDEN_DIR, { recursive: true });
      writeFileSync(file, actual);
    }
    expect(actual).toBe(readFileSync(file, 'utf8'));
  });
});

describe('standalone library', () => {
  it('wraps the fragments in the reference skeleton and parses back as an Eagle library', () => {
    const model = loadModel('C14663');
    const converted = convertPart(model, suggestCategory(model.info));
    const text = buildStandaloneLbr(REFERENCE, [converted]);
    expect(text.startsWith('<?xml version="1.0" encoding="utf-8"?>\n<!DOCTYPE eagle SYSTEM "eagle.dtd">\n<eagle version="9.7.0">\n<drawing>\n<settings>')).toBe(true);
    // skeleton copied from the reference, library content replaced
    expect(text).toContain('<layer number="94" name="Symbols"');
    expect(text).not.toContain('FUSE');
    expect(text).toContain('<package name="C0603">');
    expect(text).toContain('<symbol name="CAP_CC0603KRX7R9BB104">');
    expect(text).toContain('<deviceset name="CAP_CC0603KRX7R9BB104" prefix="C" uservalue="yes">');
    expect(text).toContain('&gt;NAME</text>');
    expect(text.endsWith('</eagle>\n')).toBe(true);
    // well-formed and structurally an Eagle library
    const doc = parseLbr(text);
    expect(doc.getElementsByTagName('packages')[0].getElementsByTagName('package')).toHaveLength(1);
    expect(doc.getElementsByTagName('devicesets')[0].getElementsByTagName('deviceset')).toHaveLength(1);
    expect(doc.getElementsByTagName('packages3d')).toHaveLength(0);
  });

  it('shares one package between two parts with the same footprint', () => {
    const a = convertPart(loadModel('C14663'), suggestCategory(loadModel('C14663').info));
    const b = { ...a, devicesetName: 'X', devicesetEl: { ...a.devicesetEl, attrs: { ...a.devicesetEl.attrs, name: 'X' } }, symbolNames: ['X'], symbolEls: [{ ...a.symbolEls[0], attrs: { name: 'X' } }] };
    const text = buildStandaloneLbr(REFERENCE, [a, b]);
    const doc = parseLbr(text);
    expect(doc.getElementsByTagName('package')).toHaveLength(1);
    expect(doc.getElementsByTagName('symbol')).toHaveLength(2);
    expect(doc.getElementsByTagName('deviceset')).toHaveLength(2);
  });
});
