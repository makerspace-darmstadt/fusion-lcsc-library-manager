import { describe, expect, it } from 'vitest';
import { arcCenter, parseSvgPath } from '../src/core/easyeda/svgpath.ts';

describe('parseSvgPath', () => {
  it('parses M/L/H/V/Z with implicit lineto', () => {
    const sp = parseSvgPath('M 0 0 L 10 0 10 10 H 0 V 5 Z');
    expect(sp).toHaveLength(1);
    expect(sp[0].closed).toBe(true);
    expect(sp[0].segments.map((s) => [s.from.x, s.from.y, s.to.x, s.to.y])).toEqual([
      [0, 0, 10, 0],
      [10, 0, 10, 10],
      [10, 10, 0, 10],
      [0, 10, 0, 5],
      [0, 5, 0, 0],
    ]);
  });

  it('parses compact syntax without spaces', () => {
    const sp = parseSvgPath('M390,310h10v-5l2,2');
    expect(sp[0].segments.map((s) => [s.to.x, s.to.y])).toEqual([
      [400, 310],
      [400, 305],
      [402, 307],
    ]);
  });

  it('keeps circular arcs as arcs with the SVG-frame sweep', () => {
    // 0603 silkscreen corner from fixture C14663: quarter circle, sweep flag 1 (clockwise on screen)
    const sp = parseSvgPath('M 4004.2527 2997.2062 A 1.2198 1.2198 0 0 1 4005.4725 2998.4261');
    const seg = sp[0].segments[0];
    expect(seg.type).toBe('arc');
    if (seg.type !== 'arc') return;
    expect(seg.sweep).toBeCloseTo(90, 2); // endpoints are rounded to 4 decimals in the data
    expect(seg.center.x).toBeCloseTo(4004.2527, 3);
    expect(seg.center.y).toBeCloseTo(2998.4261, 3);
    expect(seg.radius).toBeCloseTo(1.2198, 4);
  });

  it('uses the large-arc flag', () => {
    const sp = parseSvgPath('M 0 0 A 5 5 0 1 0 10 0');
    const seg = sp[0].segments[0];
    if (seg.type !== 'arc') throw new Error('expected arc');
    expect(seg.sweep).toBeCloseTo(-180, 3);
  });

  it('flattens elliptical arcs and Béziers to lines', () => {
    const e = parseSvgPath('M 0 0 A 10 5 0 0 1 10 5');
    expect(e[0].segments.every((s) => s.type === 'line')).toBe(true);
    expect(e[0].segments.length).toBeGreaterThan(2);
    const c = parseSvgPath('M 0 0 C 1 1 2 1 3 0');
    expect(c[0].segments).toHaveLength(8);
    expect(c[0].segments[7].to).toEqual({ x: 3, y: 0 });
  });

  it('throws on malformed input', () => {
    expect(() => parseSvgPath('10 10 L 0 0')).toThrow();
    expect(() => parseSvgPath('M 0 0 X 1 1')).toThrow();
  });
});

describe('arcCenter', () => {
  it('returns null for degenerate arcs', () => {
    expect(arcCenter({ x: 0, y: 0 }, { x: 0, y: 0 }, 1, 1, 0, false, true)).toBeNull();
    expect(arcCenter({ x: 0, y: 0 }, { x: 1, y: 0 }, 0, 1, 0, false, true)).toBeNull();
  });

  it('scales up radii that are too small', () => {
    const c = arcCenter({ x: 0, y: 0 }, { x: 10, y: 0 }, 1, 1, 0, false, true);
    expect(c?.rx).toBeCloseTo(5, 6);
    expect(Math.abs(c!.delta)).toBeCloseTo(180, 3);
  });
});
