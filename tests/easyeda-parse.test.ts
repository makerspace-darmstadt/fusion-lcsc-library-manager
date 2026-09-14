import { describe, expect, it } from 'vitest';
import { WarningCollector } from '../src/core/warnings.ts';
import { EasyEdaError } from '../src/core/easyeda/errors.ts';
import { Frame, cleanManufacturer, eagleRotation, parseComponent, parsePad, parsePin, snapUnitToGrid, splitShapes } from '../src/core/easyeda/parse.ts';
import { FIXTURE_IDS, loadFixtureJson, loadModel } from './helpers.ts';

describe('Frame', () => {
  it('subtracts the origin, scales 1 px = 0.254 mm and flips Y', () => {
    const f = new Frame(4000, 3000);
    expect(f.pt(4002.756, 3000)).toEqual({ x: 0.7, y: 0 });
    expect(f.pt(4000, 3010)).toEqual({ x: 0, y: -2.54 });
    expect(f.len(3.1496)).toBe(0.8);
  });
});

describe('eagleRotation', () => {
  it('mirrors the clockwise EasyEDA angle into Eagle counter-clockwise', () => {
    expect(eagleRotation(0)).toBe(0);
    expect(eagleRotation(90)).toBe(270);
    expect(eagleRotation(180)).toBe(180);
    expect(eagleRotation(270)).toBe(90);
    expect(eagleRotation(-90)).toBe(90);
  });
});

describe('parsePin', () => {
  const frame = new Frame(100, 120);

  it('reads number, name, connection point and body direction from the path (body right → R0)', () => {
    // TL072 gate A, pin 3 = 1IN+: connection at (60,130), path goes +20 px in x (body to the right)
    const raw =
      'P~show~0~3~60~130~180~gge79~0^^60~130^^M 60 130 h 20~#880000^^0~83~133~0~1IN+~start~~~#0000FF^^1~74~129~0~3~end~~~#0000FF^^0~77~130^^0~M 80 133 L 83 130 L 80 127';
    const w = new WarningCollector();
    const pin = parsePin(raw, frame, w)!;
    expect(pin.number).toBe('3');
    expect(pin.name).toBe('1IN+');
    expect(pin.x).toBe(-10.16);
    expect(pin.y).toBe(-2.54);
    expect(pin.length).toBe(5.08);
    expect(pin.rot).toBe(0);
    expect(pin.electric).toBe(0);
    expect(pin.nameVisible).toBe(false);
    expect(pin.numberVisible).toBe(true);
    expect(pin.dot).toBe(false);
    expect(pin.clock).toBe(false);
    expect(w.items).toEqual([]);
  });

  it('maps the other three directions (left → R180, up → R90, down → R270) and power pins', () => {
    const w = new WarningCollector();
    const left = parsePin('P~show~2~1~140~120~0~gge121~0^^140~120^^M 140 120 h -20~#880000^^0~117~123~0~OUT1~end~~~#0000FF^^1~126~119~0~1~start~~~#0000FF^^0~123~120^^0~M 120 117 L 117 120 L 120 123', frame, w)!;
    expect(left.rot).toBe(180);
    expect(left.electric).toBe(2);
    // v -20 moves up on screen (Y down) → body above the connection point → R90
    const up = parsePin('P~show~4~4~100~160~270~gge142~0^^100~160^^M 100 160 v -20~#FF0000^^0~103~137~270~VCC-~start~~~#FF0000^^1~99~146~270~4~end~~~#FF0000^^0~100~143^^0~M 103 140 L 100 137 L 97 140', frame, w)!;
    expect(up.rot).toBe(90);
    expect(up.electric).toBe(4);
    expect(up.y).toBe(-10.16);
    const down = parsePin('P~show~4~8~100~80~90~gge163~0^^100~80^^M 100 80 v 20~#FF0000^^0~103~103~270~VCC+~end~~~#FF0000^^1~99~94~270~8~start~~~#FF0000^^0~100~97^^0~M 97 100 L 100 103 L 103 100', frame, w)!;
    expect(down.rot).toBe(270);
    expect(down.y).toBe(10.16);
    expect(w.items).toEqual([]);
  });

  it('handles the compact path syntax and falls back to the number as name', () => {
    const w = new WarningCollector();
    const pin = parsePin('P~show~0~2~390~320~180~gge12~0^^390~320^^M390,320h10~#880000^^1~403.7~324~0~~start~~~#0000FF^^1~399.5~319~0~2~end~~~#0000FF^^0~397~320^^0~M 400 323 L 403 320 L 400 317', new Frame(410, 315), w)!;
    expect(pin.rot).toBe(0);
    expect(pin.length).toBe(2.54);
    expect(pin.name).toBe('2');
    expect(pin.x).toBe(-5.08);
    expect(pin.y).toBe(-1.27);
    expect(w.items).toEqual([]);
  });

  it('warns when the path is missing and derives the direction from the rotation field', () => {
    const w = new WarningCollector();
    const pin = parsePin('P~show~0~1~0~0~180~gge1~0^^0~0^^~#880000^^1~0~0~0~A~start~~~#0000FF^^1~0~0~0~1~end~~~#0000FF^^1~0~0^^1~', new Frame(0, 0), w)!;
    expect(pin.rot).toBe(0);
    expect(pin.dot).toBe(true);
    expect(pin.clock).toBe(true);
    expect(w.items.map((x) => x.code)).toEqual(['PIN_NO_PATH']);
  });
});

describe('parsePad', () => {
  const frame = new Frame(4000, 3000);

  it('parses an SMD RECT pad (0603 capacitor pad 2)', () => {
    const raw =
      'PAD~RECT~4002.756~3000~3.1496~3.5433~1~~2~0~4001.1811 2998.2283 4004.3307 2998.2283 4004.3307 3001.7717 4001.1811 3001.7717~0~gge1002~0~~Y~0~0.0000~0.2000~4002.7555,3000';
    const w = new WarningCollector();
    const pad = parsePad(raw, frame, w)!;
    expect(pad).toMatchObject({ shape: 'RECT', x: 0.7, y: 0, width: 0.8, height: 0.9, layer: 1, number: '2', holeDiameter: 0, holeLength: 0, rotation: 0, plated: true });
    expect(pad.points).toHaveLength(4);
    expect(w.items).toEqual([]);
  });

  it('parses a THT ELLIPSE pad (pin header) with a hole', () => {
    const raw = 'PAD~ELLIPSE~4001.5~3003.5~7.0866~7.0866~11~~2~2.1654~~0~gge14~0~~Y~0~0~0.2~4001.5,3003.5';
    const pad = parsePad(raw, new Frame(3996.5, 3003.5), new WarningCollector())!;
    expect(pad).toMatchObject({ shape: 'ELLIPSE', x: 1.27, y: 0, width: 1.8, height: 1.8, layer: 11, number: '2', holeDiameter: 1.1, holeLength: 0 });
  });

  it('parses an OVAL slot pad (USB-C shell) with hole length and vertical slot direction', () => {
    const raw =
      'PAD~OVAL~4017.717~3007.158~4.7244~7.0866~11~~2~1.5748~4017.717 3005.9769 4017.717 3008.3391~0~gge162~4.7244~4017.7164 3007.9461 4017.7164 3006.3713~Y~0~0~0.2~4017.7164,3007.1587';
    const pad = parsePad(raw, frame, new WarningCollector())!;
    expect(pad.shape).toBe('OVAL');
    expect(pad.width).toBe(1.2);
    expect(pad.height).toBe(1.8);
    expect(pad.holeDiameter).toBe(0.8);
    expect(pad.holeLength).toBe(1.2);
    expect(pad.holeAngle).toBe(90);
  });

  it('rejects unknown shapes with an error warning', () => {
    const w = new WarningCollector();
    expect(parsePad('PAD~STAR~0~0~1~1~1~~1~0~~0~x', frame, w)).toBeNull();
    expect(w.hasErrors).toBe(true);
  });
});

describe('splitShapes / cleanManufacturer', () => {
  it('splits packed primitives on #@$', () => {
    expect(splitShapes(['A~1#@$B~2', ' C~3 '])).toEqual(['A~1', 'B~2', 'C~3']);
  });
  it('strips CJK parentheticals only', () => {
    expect(cleanManufacturer('YAGEO(国巨)')).toBe('YAGEO');
    expect(cleanManufacturer('ST(意法半导体)')).toBe('ST');
    expect(cleanManufacturer('Texas Instruments (TI)')).toBe('Texas Instruments (TI)');
    expect(cleanManufacturer(undefined)).toBeUndefined();
  });
});

describe('parseComponent on every fixture', () => {
  it.each(FIXTURE_IDS)('%s parses without unmapped primitives or errors', (id) => {
    const model = loadModel(id);
    expect(model.info.lcsc).toBe(id);
    expect(model.units.length).toBeGreaterThan(0);
    expect(model.footprint.pads.length).toBeGreaterThan(0);
    const codes = model.warnings.map((w) => w.code);
    expect(codes).not.toContain('UNMAPPED_SYMBOL_PRIMITIVE');
    expect(codes).not.toContain('UNMAPPED_FOOTPRINT_PRIMITIVE');
    expect(codes).not.toContain('BAD_SVG_PATH');
    expect(model.warnings.filter((w) => w.severity === 'error')).toEqual([]);
    for (const u of model.units) {
      for (const p of u.pins) {
        expect(p.number).not.toBe('');
        expect([0, 90, 180, 270]).toContain(p.rot);
      }
    }
    for (const pad of model.footprint.pads) expect(pad.number).not.toBe('');
  });

  it('C14663: 0603 capacitor has 2 pins on grid and 2 SMD pads 1.4 mm apart', () => {
    const m = loadModel('C14663');
    expect(m.info).toMatchObject({ title: 'CC0603KRX7R9BB104', packageName: 'C0603', prefix: 'C', manufacturer: 'YAGEO', mpn: 'CC0603KRX7R9BB104', jlcClass: 'Basic Part' });
    expect(m.units).toHaveLength(1);
    const pins = m.units[0].pins.map((p) => [p.number, p.x, p.y, p.rot]);
    expect(pins).toEqual([
      ['1', -5.08, 0, 0],
      ['2', 5.08, 0, 180],
    ]);
    const pads = m.footprint.pads.map((p) => [p.number, p.x, p.y, p.width, p.height]).sort();
    expect(pads).toEqual([
      ['1', -0.7, 0, 0.8, 0.9],
      ['2', 0.7, 0, 0.8, 0.9],
    ]);
    // corner arcs of the silkscreen: quarter circles, clockwise on screen → negative Eagle curve
    const arcs = m.footprint.graphics.filter((g) => g.kind === 'wire' && g.curve !== undefined);
    expect(arcs).toHaveLength(4);
    for (const a of arcs) if (a.kind === 'wire') expect(a.curve).toBe(-90);
    expect(m.warnings.filter((w) => w.code === 'PIN_OFF_GRID')).toEqual([]);
  });

  it('C6961: TL072 has two units from subparts, with power pins only in the first', () => {
    const m = loadModel('C6961');
    expect(m.units).toHaveLength(2);
    expect(m.units[0].pins.map((p) => p.number).sort()).toEqual(['1', '2', '3', '4', '8']);
    expect(m.units[1].pins.map((p) => p.number).sort()).toEqual(['5', '6', '7']);
    expect(m.units[0].pins.find((p) => p.number === '8')?.name).toBe('VCC+');
    expect(m.warnings.some((w) => w.code === 'MULTI_UNIT')).toBe(true);
  });

  it('C2040: RP2040 exposes duplicate pin names and the exposed pad 57', () => {
    const m = loadModel('C2040');
    const names = m.units[0].pins.map((p) => p.name);
    expect(names.filter((n) => n === 'IOVDD')).toHaveLength(6);
    expect(m.footprint.pads.find((p) => p.number === '57')).toMatchObject({ width: 3.1, height: 3.1, shape: 'RECT', layer: 1 });
    expect(m.footprint.pads).toHaveLength(57);
  });

  it('C3131: fuse holder has two THT OVAL slot pads', () => {
    const m = loadModel('C3131');
    const slots = m.footprint.pads.filter((p) => p.holeLength > 0);
    expect(slots).toHaveLength(2);
    expect(slots[0]).toMatchObject({ shape: 'OVAL', layer: 11, width: 1, height: 2.2, holeDiameter: 0.6, holeLength: 1.7, holeAngle: 90 });
  });

  it('C165948: USB-C has POLYGON pads with combined numbers, slot pads and holes', () => {
    const m = loadModel('C165948');
    const poly = m.footprint.pads.filter((p) => p.shape === 'POLYGON');
    expect(poly.map((p) => p.number).sort()).toEqual(['A1B12', 'A4B9', 'B1A12', 'B4A9']);
    expect(poly[0].points.length).toBeGreaterThan(4);
    expect(m.footprint.pads.filter((p) => p.holeLength > 0)).toHaveLength(4);
    expect(m.footprint.graphics.filter((g) => g.kind === 'hole')).toHaveLength(2);
    const pinNumbers = m.units[0].pins.map((p) => p.number).sort();
    expect(pinNumbers).toEqual(m.footprint.pads.map((p) => p.number).sort());
  });

  it('C124375: pin header footprint RECT primitive lands on the silk layer with 0.254 mm stroke', () => {
    const m = loadModel('C124375');
    const rect = m.footprint.graphics.find((g) => g.kind === 'rect');
    expect(rect).toMatchObject({ kind: 'rect', layer: 3, width: 0.254, filled: false, x1: -2.54, y1: -1.27, x2: 2.54, y2: 1.27 });
  });

  it('C8545: white-filled symbol polygons stay outlines; C20526 dark-filled ones become polygons', () => {
    const m = loadModel('C8545');
    // both PG primitives are filled #FEFEFE (white) → drawn as wires, not filled polygons
    expect(m.units[0].graphics.filter((g) => g.kind === 'polygon')).toHaveLength(0);
    // vertical pins: D above (R270 = body below the connection point), S below (R90)
    expect(m.units[0].pins.map((p) => [p.name, p.rot])).toEqual([
      ['D', 270],
      ['G', 0],
      ['S', 90],
    ]);
    const n = loadModel('C20526');
    expect(n.units[0].graphics.filter((g) => g.kind === 'polygon' && g.filled)).toHaveLength(1);
    // C124375: filled ellipse (pin-1 marker) becomes a filled circle
    const h = loadModel('C124375');
    expect(h.units[0].graphics.filter((g) => g.kind === 'circle' && g.filled)).toHaveLength(1);
  });
});

describe('snapUnitToGrid', () => {
  it('shifts a unit whose pins share a half-grid offset and keeps the graphics attached', () => {
    const m = loadModel('C3131');
    const unit = m.units[0];
    // raw pins sit at ±45 px = ±11.43 mm; the unit is shifted by +1.27 mm
    expect(unit.pins.map((p) => [p.number, p.x, p.y])).toEqual([
      ['1', -10.16, 0],
      ['2', 12.7, 0],
    ]);
    // the body circle (raw cx = -20 px, origin x = 5 px → -6.35 mm) moved by the same 1.27 mm
    const circle = unit.graphics.find((g) => g.kind === 'circle');
    expect(circle).toMatchObject({ x: -5.08, y: 0 });
    expect(m.warnings.map((w) => w.code)).toContain('SYMBOL_SHIFTED');
    expect(m.warnings.map((w) => w.code)).not.toContain('PIN_OFF_GRID');
    // C8734: every pin sits exactly on a half-grid point in both axes → shifted, nothing left off-grid
    const stm = loadModel('C8734');
    expect(stm.warnings.filter((w) => w.code === 'PIN_OFF_GRID')).toEqual([]);
    expect(stm.units[0].pins.every((p) => Number.isInteger(Math.round((p.x / 2.54) * 1e6) / 1e6))).toBe(true);
  });

  it('warns for pins that stay off-grid when the offsets disagree', () => {
    const w = new WarningCollector();
    const unit = {
      pins: [
        parsePin('P~show~0~1~0~0~180~a~0^^0~0^^M 0 0 h 10~#800^^0~0~0~0~A~start~~~#800^^0~0~0~0~1~end~~~#800^^0~0~0^^0~', new Frame(0, 0), w)!,
        parsePin('P~show~0~2~0~15~180~b~0^^0~15^^M 0 15 h 10~#800^^0~0~0~0~B~start~~~#800^^0~0~0~0~2~end~~~#800^^0~0~0^^0~', new Frame(0, 0), w)!,
      ],
      graphics: [],
    };
    snapUnitToGrid(unit, w);
    expect(w.items.map((x) => x.code)).toEqual(['PIN_OFF_GRID']);
    expect(w.items[0].message).toMatch(/Pin 2/);
  });
});

describe('parseComponent error handling', () => {
  it('reports API "not found" answers', () => {
    expect(() => parseComponent(loadFixtureJson('notfound'), 'C999999999')).toThrow(EasyEdaError);
    try {
      parseComponent(loadFixtureJson('notfound'), 'C999999999');
    } catch (e) {
      expect((e as EasyEdaError).code).toBe('NOT_FOUND');
    }
  });

  it('reports parts without symbol data as not importable', () => {
    try {
      parseComponent(loadFixtureJson('nodatastr'), 'C0000001');
      throw new Error('should have thrown');
    } catch (e) {
      expect((e as EasyEdaError).code).toBe('NOT_IMPORTABLE');
      expect((e as EasyEdaError).message).toMatch(/no schematic symbol data/);
    }
  });

  it('rejects garbage', () => {
    expect(() => parseComponent('nope', 'C1')).toThrow(/Unexpected response/);
    expect(() => parseComponent({ success: true }, 'C1')).toThrow(/no result/);
  });
});
