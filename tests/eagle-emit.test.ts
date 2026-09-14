import { describe, expect, it } from 'vitest';
import { DEFAULT_CATEGORIES, isPassiveCategory, suggestCategory } from '../src/core/categories.ts';
import { convertPart } from '../src/core/eagle/convert.ts';
import { buildDescription, gateName } from '../src/core/eagle/deviceset.ts';
import { dedupeNames, sanitiseName, sanitisePinName } from '../src/core/eagle/names.ts';
import { emitPackage } from '../src/core/eagle/package.ts';
import { emitSymbol, pinLength, pinVisible } from '../src/core/eagle/symbol.ts';
import { el, fmt, serialize } from '../src/core/eagle/xml.ts';
import type { Footprint, Pad, SymbolPin, SymbolUnit } from '../src/core/easyeda/types.ts';
import { WarningCollector } from '../src/core/warnings.ts';
import { loadModel } from './helpers.ts';

const cat = (id: string) => DEFAULT_CATEGORIES.find((c) => c.id === id)!;

function pad(over: Partial<Pad>): Pad {
  return {
    shape: 'RECT',
    x: 0,
    y: 0,
    width: 1,
    height: 1,
    layer: 1,
    number: '1',
    holeDiameter: 0,
    holeLength: 0,
    holeAngle: 0,
    rotation: 0,
    points: [],
    plated: true,
    raw: 'PAD~test',
    ...over,
  };
}

function pin(over: Partial<SymbolPin>): SymbolPin {
  return {
    number: '1',
    name: 'P1',
    x: 0,
    y: 0,
    length: 2.54,
    rot: 0,
    electric: 0,
    nameVisible: true,
    numberVisible: true,
    dot: false,
    clock: false,
    raw: 'P~test',
    ...over,
  };
}

const fp = (pads: Pad[], graphics: Footprint['graphics'] = []): Footprint => ({ title: 'TEST', pads, graphics });

describe('xml', () => {
  it('formats numbers like Eagle and escapes text/attributes', () => {
    expect(fmt(-0)).toBe('0');
    expect(fmt(0.1 + 0.2)).toBe('0.3');
    expect(fmt(1.5)).toBe('1.5');
    expect(fmt(1e-7)).toBe('0');
    expect(serialize(el('text', { x: 1, y: -2.54, s: 'a"b<c' }, ['>NAME & <b>']))).toBe('<text x="1" y="-2.54" s="a&quot;b&lt;c">&gt;NAME &amp; &lt;b&gt;</text>\n');
    expect(serialize(el('a', {}, [el('b')]))).toBe('<a>\n<b/>\n</a>\n');
  });
});

describe('names', () => {
  it('sanitises library names', () => {
    expect(sanitiseName('SOT-23-3_L2.9-W1.3-P1.90-LS2.4-BR')).toBe('SOT-23-3_L2.9-W1.3-P1.90-LS2.4-BR');
    expect(sanitiseName('ESP32-S3-WROOM-1(N8R2)')).toBe('ESP32-S3-WROOM-1_N8R2');
    expect(sanitiseName('  a b/c  ')).toBe('A_B_C');
    expect(sanitiseName('x'.repeat(100)).length).toBe(64);
    expect(sanitiseName('')).toBe('UNNAMED');
  });
  it('dedupes with @2/@3 and keeps first occurrence untouched', () => {
    expect(dedupeNames(['GND', 'A', 'GND', 'GND', 'A@2'])).toEqual(['GND', 'A', 'GND@2', 'GND@3', 'A@2']);
    expect(dedupeNames(['0', '0'], '_')).toEqual(['0', '0_2']);
    expect(sanitisePinName(' 1IN +')).toBe('1IN_+');
  });
});

describe('emitPackage pads', () => {
  it('SMD RECT → smd roundness 0; OVAL/ELLIPSE → roundness 100; bottom layer → 16; rotation kept', () => {
    const w = new WarningCollector();
    const r = emitPackage(fp([pad({ number: '1', width: 0.8, height: 0.9 }), pad({ number: '2', shape: 'OVAL', layer: 2, rotation: 90, x: 1 })]), 'P', w);
    const smds = r.element.children.filter((c) => typeof c !== 'string' && c.name === 'smd') as ReturnType<typeof el>[];
    expect(smds[0].attrs).toEqual({ name: '1', x: 0, y: 0, dx: 0.8, dy: 0.9, layer: 1, roundness: 0 });
    expect(smds[1].attrs).toEqual({ name: '2', x: 1, y: 0, dx: 1, dy: 1, layer: 16, roundness: 100, rot: 'R90' });
    expect(w.items).toEqual([]);
  });

  it('THT ELLIPSE → round pad with drill = 2·holeRadius, diameter = pad size', () => {
    const w = new WarningCollector();
    const r = emitPackage(fp([pad({ shape: 'ELLIPSE', layer: 11, width: 1.8, height: 1.8, holeDiameter: 1.1 })]), 'P', w);
    const p = r.element.children.find((c) => typeof c !== 'string' && c.name === 'pad') as ReturnType<typeof el>;
    expect(p.attrs).toEqual({ name: '1', x: 0, y: 0, drill: 1.1, diameter: 1.8 });
    expect(w.items).toEqual([]);
  });

  it('THT RECT → square; THT OVAL → long with diameter = short axis and R90 when vertical', () => {
    const w = new WarningCollector();
    const r = emitPackage(
      fp([
        pad({ number: '1', shape: 'RECT', layer: 11, width: 1.8, height: 1.8, holeDiameter: 1 }),
        pad({ number: '2', shape: 'OVAL', layer: 11, width: 1, height: 2, holeDiameter: 0.6, x: 2.54 }),
        pad({ number: '3', shape: 'OVAL', layer: 11, width: 2, height: 1, holeDiameter: 0.6, x: 5.08 }),
      ]),
      'P',
      w,
    );
    const pads = r.element.children.filter((c) => typeof c !== 'string' && c.name === 'pad') as ReturnType<typeof el>[];
    expect(pads[0].attrs).toMatchObject({ shape: 'square', diameter: 1.8, drill: 1 });
    expect(pads[1].attrs).toMatchObject({ shape: 'long', diameter: 1, drill: 0.6, rot: 'R90' });
    expect(pads[2].attrs).toMatchObject({ shape: 'long', diameter: 1, drill: 0.6 });
    expect(pads[2].attrs.rot).toBeUndefined();
    expect(w.items).toEqual([]);
  });

  it('warns when an oval THT pad is not 2:1', () => {
    const w = new WarningCollector();
    emitPackage(fp([pad({ shape: 'OVAL', layer: 11, width: 1, height: 3, holeDiameter: 0.6 })]), 'P', w);
    expect(w.items.map((x) => x.code)).toEqual(['PAD_ASPECT']);
  });

  it('slot pads → long pad + Milling wire along the slot + warning (C3131 geometry)', () => {
    const w = new WarningCollector();
    // 1.0 × 2.2 mm oval, hole ⌀0.6, slot length 1.7 mm, vertical
    const r = emitPackage(fp([pad({ shape: 'OVAL', layer: 11, width: 1, height: 2.2, holeDiameter: 0.6, holeLength: 1.7, holeAngle: 90, x: -11, y: 0 })]), 'P', w);
    const els = r.element.children.filter((c) => typeof c !== 'string') as ReturnType<typeof el>[];
    const p = els.find((e) => e.name === 'pad')!;
    const mill = els.find((e) => e.name === 'wire' && e.attrs.layer === 46)!;
    expect(p.attrs).toMatchObject({ shape: 'long', drill: 0.6, diameter: 1, rot: 'R90' });
    // centre line = (1.7 - 0.6) / 2 = 0.55 each side, drawn with the drill diameter as width
    expect(mill.attrs).toEqual({ x1: -11, y1: -0.55, x2: -11, y2: 0.55, width: 0.6, layer: 46 });
    expect(w.items.map((x) => x.code)).toEqual(['PAD_ASPECT', 'SLOT_PAD']);
  });

  it('POLYGON SMD pads → bounding-box smd plus copper polygon and a warning', () => {
    const w = new WarningCollector();
    const pts = [
      { x: -1, y: -1 },
      { x: 1, y: -1 },
      { x: 1, y: 1 },
      { x: 0, y: 1 },
      { x: -1, y: 0 },
    ];
    const r = emitPackage(fp([pad({ shape: 'POLYGON', width: 2, height: 2, points: pts })]), 'P', w);
    const els = r.element.children.filter((c) => typeof c !== 'string') as ReturnType<typeof el>[];
    expect(els.find((e) => e.name === 'smd')!.attrs).toMatchObject({ dx: 2, dy: 2, roundness: 0 });
    const poly = els.find((e) => e.name === 'polygon')!;
    expect(poly.attrs).toEqual({ width: 0.0254, layer: 1 });
    expect(poly.children).toHaveLength(5);
    expect(w.items.map((x) => x.code)).toEqual(['POLYGON_PAD']);
  });

  it('duplicate pad numbers are renamed N_2 and reported; non-plated pads become holes', () => {
    const w = new WarningCollector();
    const r = emitPackage(fp([pad({ number: '0' }), pad({ number: '0', x: 1 }), pad({ number: '9', layer: 11, holeDiameter: 1, plated: false, x: 3 })]), 'P', w);
    expect(r.padNames).toEqual(['0', '0_2', '9']);
    const els = r.element.children.filter((c) => typeof c !== 'string') as ReturnType<typeof el>[];
    expect(els.filter((e) => e.name === 'hole')).toHaveLength(1);
    expect(w.items.map((x) => x.code).sort()).toEqual(['DUPLICATE_PAD_NUMBER', 'PAD_NOT_PLATED']);
  });
});

describe('emitPackage graphics', () => {
  it('maps layers (3→21, 12→51, 100→51, 10→20), drops paste/mask, warns on unknown layers', () => {
    const w = new WarningCollector();
    const g: Footprint['graphics'] = [
      { kind: 'wire', x1: 0, y1: 0, x2: 1, y2: 0, width: 0.2, layer: 3, raw: 'a' },
      { kind: 'wire', x1: 0, y1: 0, x2: 1, y2: 0, width: 0.2, layer: 12, raw: 'b' },
      { kind: 'wire', x1: 0, y1: 0, x2: 1, y2: 0, width: 0.2, layer: 100, raw: 'c' },
      { kind: 'wire', x1: 0, y1: 0, x2: 1, y2: 0, width: 0.2, layer: 10, raw: 'd' },
      { kind: 'wire', x1: 0, y1: 0, x2: 1, y2: 0, width: 0.2, layer: 5, raw: 'paste' },
      { kind: 'wire', x1: 0, y1: 0, x2: 1, y2: 0, width: 0.2, layer: 42, raw: 'inner' },
    ];
    const r = emitPackage(fp([pad({})], g), 'P', w);
    const wires = r.element.children.filter((c) => typeof c !== 'string' && c.name === 'wire') as ReturnType<typeof el>[];
    expect(wires.map((x) => x.attrs.layer)).toEqual([21, 51, 51, 20, 51]);
    expect(w.items.map((x) => x.code)).toEqual(['UNMAPPED_LAYER']);
    expect(w.items[0].raw).toBe('inner');
  });

  it('arc wires keep their curve, circles never get width 0, rect → 4 wires, regions → polygons, holes → hole', () => {
    const w = new WarningCollector();
    const g: Footprint['graphics'] = [
      { kind: 'wire', x1: 0, y1: 1, x2: 1, y2: 0, width: 0.2, layer: 3, curve: -90, raw: 'a' },
      { kind: 'circle', x: 0, y: 0, radius: 1, width: 0, layer: 12, raw: 'c' },
      { kind: 'rect', x1: -1, y1: -1, x2: 1, y2: 1, width: 0.254, layer: 3, filled: false, raw: 'r' },
      { kind: 'polygon', points: [{ x: 0, y: 0 }, { x: 1, y: 0, curve: 90 }, { x: 1, y: 1 }], layer: 99, regionType: 'solid', raw: 's' },
      { kind: 'hole', x: 2, y: 2, drill: 1.2, raw: 'h' },
    ];
    const r = emitPackage(fp([pad({})], g), 'P', w);
    const els = r.element.children.filter((c) => typeof c !== 'string') as ReturnType<typeof el>[];
    expect(els.find((e) => e.name === 'wire')!.attrs.curve).toBe(-90);
    expect(els.find((e) => e.name === 'circle')!.attrs.width).toBe(0.0254);
    expect(els.filter((e) => e.name === 'wire')).toHaveLength(5);
    const poly = els.find((e) => e.name === 'polygon')!;
    expect(poly.attrs.layer).toBe(51);
    expect((poly.children[1] as ReturnType<typeof el>).attrs.curve).toBe(90);
    expect(els.find((e) => e.name === 'hole')!.attrs).toEqual({ x: 2, y: 2, drill: 1.2 });
    expect(w.items).toEqual([]);
  });

  it('places >NAME above and >VALUE below the bounding box; EasyEDA name texts replace the auto >NAME', () => {
    const w = new WarningCollector();
    const r = emitPackage(fp([pad({ x: -1, width: 1, height: 1 }), pad({ number: '2', x: 1, width: 1, height: 1 })]), 'P', w);
    const texts = r.element.children.filter((c) => typeof c !== 'string' && c.name === 'text') as ReturnType<typeof el>[];
    expect(texts.map((t) => [t.children[0], t.attrs.layer, t.attrs.x, t.attrs.y, t.attrs.align])).toEqual([
      ['>NAME', 25, 0, 1, 'bottom-center'],
      ['>VALUE', 27, 0, -1, 'top-center'],
    ]);
    const r2 = emitPackage(fp([pad({})], [{ kind: 'text', textType: 'P', x: 3, y: 4, rot: 90, mirror: false, layer: 3, size: 1, width: 0.1, text: 'U?', raw: 't' }]), 'P', w);
    const t2 = r2.element.children.filter((c) => typeof c !== 'string' && c.name === 'text') as ReturnType<typeof el>[];
    expect(t2.map((t) => [t.children[0], t.attrs.layer, t.attrs.rot])).toEqual([
      ['>NAME', 25, 'R90'],
      ['>VALUE', 27, undefined],
    ]);
  });
});

describe('emitSymbol', () => {
  it('maps pin length, visibility, direction, function and rotation', () => {
    const w = new WarningCollector();
    const p = pin({});
    expect(pinLength(0, p, w)).toBe('point');
    expect(pinLength(2.54, p, w)).toBe('short');
    expect(pinLength(5.08, p, w)).toBe('middle');
    expect(pinLength(7.62, p, w)).toBe('long');
    expect(w.items).toEqual([]);
    expect(pinLength(3.81, p, w)).toBe('short');
    expect(w.items.map((x) => x.code)).toEqual(['PIN_LENGTH']);
    expect(pinVisible(pin({ nameVisible: true, numberVisible: true }))).toBe('both');
    expect(pinVisible(pin({ nameVisible: true, numberVisible: false }))).toBe('pin');
    expect(pinVisible(pin({ nameVisible: false, numberVisible: true }))).toBe('pad');
    expect(pinVisible(pin({ nameVisible: false, numberVisible: false }))).toBe('off');

    const unit: SymbolUnit = {
      pins: [
        pin({ number: '1', name: 'CLK', x: -5.08, y: 0, rot: 0, electric: 1, clock: true }),
        pin({ number: '2', name: 'Q', x: 5.08, y: 0, rot: 180, electric: 2, dot: true }),
        pin({ number: '3', name: 'VCC', x: 0, y: 5.08, rot: 270, electric: 4, length: 5.08 }),
        pin({ number: '4', name: 'IO', x: 0, y: -5.08, rot: 90, electric: 3, dot: true, clock: true }),
      ],
      graphics: [{ kind: 'wire', x1: -2.54, y1: -2.54, x2: 2.54, y2: 2.54, raw: 'w' }],
    };
    const r = emitSymbol(unit, 'S', new WarningCollector());
    const pins = r.element.children.filter((c) => typeof c !== 'string' && c.name === 'pin') as ReturnType<typeof el>[];
    expect(pins.map((p) => p.attrs)).toEqual([
      { name: 'CLK', x: -5.08, y: 0, visible: 'both', length: 'short', direction: 'in', function: 'clk' },
      { name: 'Q', x: 5.08, y: 0, visible: 'both', length: 'short', direction: 'out', function: 'dot', rot: 'R180' },
      { name: 'VCC', x: 0, y: 5.08, visible: 'both', length: 'middle', direction: 'pwr', rot: 'R270' },
      { name: 'IO', x: 0, y: -5.08, visible: 'both', length: 'short', direction: 'io', function: 'dotclk', rot: 'R90' },
    ]);
  });

  it('dedupes pin names with @2 and places >NAME/>VALUE around the body', () => {
    const unit: SymbolUnit = {
      pins: [pin({ number: '1', name: 'GND', x: -5.08 }), pin({ number: '2', name: 'GND', x: 5.08, rot: 180 })],
      graphics: [
        { kind: 'circle', x: 0, y: 0, radius: 2.54, filled: false, raw: 'c' },
        { kind: 'polygon', points: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 0, y: 1 }], filled: true, raw: 'p' },
      ],
    };
    const w = new WarningCollector();
    const r = emitSymbol(unit, 'S', w);
    expect(r.pinNames).toEqual(['GND', 'GND@2']);
    expect(w.items.map((x) => x.code)).toEqual(['DUPLICATE_PIN_NAME']);
    const texts = r.element.children.filter((c) => typeof c !== 'string' && c.name === 'text') as ReturnType<typeof el>[];
    expect(texts.map((t) => [t.children[0], t.attrs.layer, t.attrs.x, t.attrs.y])).toEqual([
      ['>NAME', 95, -2.54, 3.81],
      ['>VALUE', 96, -2.54, -3.81],
    ]);
    const els = r.element.children.filter((c) => typeof c !== 'string') as ReturnType<typeof el>[];
    expect(els.find((e) => e.name === 'circle')!.attrs).toEqual({ x: 0, y: 0, radius: 2.54, width: 0.254, layer: 94 });
    expect(els.find((e) => e.name === 'polygon')!.attrs).toEqual({ width: 0.254, layer: 94 });
  });
});

describe('deviceset', () => {
  it('names gates G$1 for single units and A, B, … for multi-unit parts', () => {
    expect(gateName(0, 1)).toBe('G$1');
    expect(gateName(0, 2)).toBe('A');
    expect(gateName(1, 2)).toBe('B');
  });

  it('builds the description in the brief format', () => {
    const m = loadModel('C14663');
    expect(buildDescription(m, cat('capacitor'))).toMatch(/^100nF \(104\) ±10% 50V — LCSC C14663 — YAGEO CC0603KRX7R9BB104\. Keywords: capacitor, ceramic, mlcc, multilayer ceramic capacitors mlcc - smd\/smt\n<a href=/);
  });

  it('C14663: connects pins to pads by number, passives get uservalue and the LCSC attribute', () => {
    const c = convertPart(loadModel('C14663'), cat('capacitor'));
    expect(c.devicesetName).toBe('CAP_CC0603KRX7R9BB104');
    expect(c.packageName).toBe('C0603');
    expect(c.devicesetEl.attrs).toEqual({ name: 'CAP_CC0603KRX7R9BB104', prefix: 'C', uservalue: 'yes' });
    expect(c.hasErrors).toBe(false);
    expect(c.warnings.filter((w) => w.severity !== 'info')).toEqual([]);
  });

  it('C6961: two gates A/B pointing at two symbols, all 8 pads connected', () => {
    const c = convertPart(loadModel('C6961'), cat('ic'));
    expect(c.symbolNames).toEqual(['IC_TL072CDT_A', 'IC_TL072CDT_B']);
    const gates = (c.devicesetEl.children[1] as ReturnType<typeof el>).children as ReturnType<typeof el>[];
    expect(gates.map((g) => [g.attrs.name, g.attrs.symbol])).toEqual([
      ['A', 'IC_TL072CDT_A'],
      ['B', 'IC_TL072CDT_B'],
    ]);
    expect(c.warnings.filter((w) => w.code === 'UNCONNECTED_PAD')).toEqual([]);
    expect(c.hasErrors).toBe(false);
    expect(c.devicesetEl.attrs.uservalue).toBeUndefined();
  });

  it('C2040: duplicate pin names become IOVDD@2…, exposed pad 57 connects to GND', () => {
    const c = convertPart(loadModel('C2040'), cat('ic'));
    const sym = c.symbolEls[0];
    const names = (sym.children as ReturnType<typeof el>[]).filter((e) => e.name === 'pin').map((p) => String(p.attrs.name));
    expect(names.filter((n) => /^IOVDD/.test(n)).sort()).toEqual(['IOVDD', 'IOVDD@2', 'IOVDD@3', 'IOVDD@4', 'IOVDD@5', 'IOVDD@6']);
    expect(c.hasErrors).toBe(false);
  });

  it('C138392: duplicate pin number and a pin without pad make the part not importable', () => {
    const c = convertPart(loadModel('C138392'), cat('connector'));
    expect(c.hasErrors).toBe(true);
    expect(c.warnings.map((w) => w.code)).toContain('PIN_WITHOUT_PAD');
    expect(c.warnings.map((w) => w.code)).toContain('DUPLICATE_PIN_NUMBER');
    expect(c.warnings.filter((w) => w.code === 'UNCONNECTED_PAD')).toHaveLength(2);
  });

  it('C165948: combined pad numbers (A1B12) connect one pin to one pad; slots and polygons are reported', () => {
    const c = convertPart(loadModel('C165948'), cat('connector'));
    expect(c.hasErrors).toBe(false);
    const codes = new Set(c.warnings.map((w) => w.code));
    expect(codes.has('SLOT_PAD')).toBe(true);
    expect(codes.has('POLYGON_PAD')).toBe(true);
    expect(codes.has('UNCONNECTED_PAD')).toBe(false);
    expect(codes.has('PIN_WITHOUT_PAD')).toBe(false);
  });
});

describe('categories', () => {
  it('suggests from prefix and text hints', () => {
    const s = (prefix: string, tags: string[], title = '', description = '') => suggestCategory({ prefix, tags, title, description }).id;
    expect(s('C', [])).toBe('capacitor');
    expect(s('R', [])).toBe('resistor');
    expect(s('L', [])).toBe('inductor');
    expect(s('D', ['Schottky Diodes'])).toBe('diode');
    expect(s('D', ['Light Emitting Diodes (LED)'])).toBe('led');
    expect(s('Q', [])).toBe('transistor');
    expect(s('U', [])).toBe('ic');
    expect(s('U', ['USB Connectors'])).toBe('connector');
    expect(s('J', [])).toBe('connector');
    expect(s('S', ['Tactile Switches'])).toBe('switch');
    expect(s('Y', [])).toBe('crystal');
    expect(s('F', ['Fuse Holders'])).toBe('misc');
    expect(suggestCategory(loadModel('C6961').info).id).toBe('ic');
    expect(suggestCategory(loadModel('C165948').info).id).toBe('connector');
    expect(isPassiveCategory(cat('capacitor'))).toBe(true);
    expect(isPassiveCategory(cat('ic'))).toBe(false);
  });
});
