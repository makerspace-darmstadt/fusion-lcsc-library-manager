/**
 * Parse the EasyEDA `components` API JSON into the typed intermediate model.
 *
 * Field orders below were verified against the committed fixtures (see AGENTS.md for deviations from
 * the original brief). Coordinates are converted here: origin subtracted, px → mm, Y flipped.
 */

import { WarningCollector } from '../warnings.ts';
import { pxToMm, round, SYMBOL_GRID_MM } from '../units.ts';
import { EasyEdaError } from './errors.ts';
import { parseSvgPath, type SubPath } from './svgpath.ts';
import type {
  EagleRotation,
  Footprint,
  FootprintGraphic,
  Pad,
  PadShape,
  PartInfo,
  PartModel,
  PinElectric,
  Point,
  SymbolGraphic,
  SymbolPin,
  SymbolUnit,
  Vertex,
} from './types.ts';

// ---------------------------------------------------------------------------------------------
// Raw JSON shape (only the fields we read)
// ---------------------------------------------------------------------------------------------

export interface RawDataStr {
  head: { x?: number | string; y?: number | string; c_para?: Record<string, string> };
  shape?: string[];
}

export interface RawSubpart {
  title?: string;
  dataStr?: RawDataStr;
}

export interface RawComponent {
  uuid?: string;
  title?: string;
  description?: string;
  tags?: string[];
  lcsc?: { number?: string; url?: string };
  szlcsc?: { number?: string; url?: string };
  dataStr?: RawDataStr;
  subparts?: Record<string, RawSubpart>;
  packageDetail?: { title?: string; dataStr?: RawDataStr };
}

export interface ComponentResponse {
  success: boolean;
  code?: number;
  message?: string;
  result?: RawComponent;
}

// ---------------------------------------------------------------------------------------------
// Coordinate frame
// ---------------------------------------------------------------------------------------------

/** Converts EasyEDA canvas px (Y down) around an origin into mm (Y up). */
export class Frame {
  readonly ox: number;
  readonly oy: number;

  constructor(ox: number, oy: number) {
    this.ox = ox;
    this.oy = oy;
  }

  pt(x: number, y: number): Point {
    return { x: pxToMm(x - this.ox), y: pxToMm(-(y - this.oy)) };
  }

  len(px: number): number {
    return pxToMm(px);
  }
}

const num = (s: string | undefined, fallback = 0): number => {
  if (s === undefined || s === '') return fallback;
  const n = parseFloat(s);
  return Number.isFinite(n) ? n : fallback;
};

const isFilled = (fill: string | undefined): boolean => {
  if (!fill) return false;
  const f = fill.trim().toLowerCase();
  return f !== 'none' && f !== '' && f !== '#ffffff' && f !== '#fefefe' && f !== 'white';
};

function parsePoints(s: string): number[] {
  return s
    .trim()
    .split(/[\s,]+/)
    .filter((t) => t !== '')
    .map((t) => parseFloat(t));
}

/** Split the packed shape strings (`#@$` separator) into individual primitive strings. */
export function splitShapes(shapes: string[] | undefined): string[] {
  const out: string[] = [];
  for (const s of shapes ?? []) {
    for (const part of s.split('#@$')) {
      const p = part.trim();
      if (p) out.push(p);
    }
  }
  return out;
}

/** Eagle rotation normalised from an EasyEDA (SVG, clockwise-on-screen) rotation value. */
export function eagleRotation(easyedaDeg: number): number {
  const r = ((360 - (easyedaDeg % 360)) % 360 + 360) % 360;
  return round(r, 3);
}

// Path segments → model geometry ------------------------------------------------------------------

/**
 * Curve of an SVG-frame arc after the Y flip: clockwise on screen becomes negative in Eagle.
 * Arc endpoints in the data are rounded to 4 decimals, which yields angles like 90.005°; angles within
 * 0.02° of a whole degree are snapped to it.
 */
export function flipSweep(sweep: number): number {
  const v = -sweep;
  const whole = Math.round(v);
  return round(Math.abs(v - whole) < 0.02 ? whole : v, 3);
}

function subpathsToSymbolWires(subpaths: SubPath[], frame: Frame, raw: string): SymbolGraphic[] {
  const out: SymbolGraphic[] = [];
  for (const sp of subpaths) {
    for (const seg of sp.segments) {
      const a = frame.pt(seg.from.x, seg.from.y);
      const b = frame.pt(seg.to.x, seg.to.y);
      if (seg.type === 'arc') out.push({ kind: 'wire', x1: a.x, y1: a.y, x2: b.x, y2: b.y, curve: flipSweep(seg.sweep), raw });
      else out.push({ kind: 'wire', x1: a.x, y1: a.y, x2: b.x, y2: b.y, raw });
    }
  }
  return out;
}

function subpathToVertices(sp: SubPath, frame: Frame): Vertex[] {
  const verts: Vertex[] = [];
  for (const seg of sp.segments) {
    const a = frame.pt(seg.from.x, seg.from.y);
    const v: Vertex = { x: a.x, y: a.y };
    if (seg.type === 'arc') v.curve = flipSweep(seg.sweep);
    verts.push(v);
  }
  // Drop a trailing vertex equal to the first one (closing segment already implied by the polygon).
  if (verts.length > 1) {
    const first = verts[0];
    const last = sp.segments[sp.segments.length - 1];
    const lastTo = frame.pt(last.to.x, last.to.y);
    if (lastTo.x !== first.x || lastTo.y !== first.y) verts.push({ x: lastTo.x, y: lastTo.y });
  }
  // Remove consecutive duplicates.
  return verts.filter((v, i) => i === 0 || v.x !== verts[i - 1].x || v.y !== verts[i - 1].y || v.curve !== undefined);
}

// ---------------------------------------------------------------------------------------------
// Symbol
// ---------------------------------------------------------------------------------------------

const PIN_PATH_RE = /M\s*(-?[\d.]+)[\s,]*(-?[\d.]+)\s*([hvlHVL])\s*(-?[\d.]+)(?:[\s,]*(-?[\d.]+))?/;

/** Parse a pin primitive. Exported for unit tests. */
export function parsePin(raw: string, frame: Frame, warnings: WarningCollector): SymbolPin | null {
  const sections = raw.split('^^');
  const head = sections[0].split('~');
  // P~display~electric~number~x~y~rotation~id~locked
  const number = (head[3] ?? '').trim();
  const x = num(head[4]);
  const y = num(head[5]);
  const rotField = head[6] ?? '';
  const electricRaw = num(head[2]);
  const electric = (electricRaw >= 0 && electricRaw <= 4 ? electricRaw : 0) as PinElectric;

  // The pin path is a short line between the connection point and the body edge. It may start at
  // either end (fixtures contain both `M cx cy h L` and `M bx by h -L`), so the body direction is
  // taken as "path endpoint farthest from the connection point".
  const pathStr = (sections[2] ?? '').split('~')[0] ?? '';
  let dx = 0;
  let dy = 0;
  const m = PIN_PATH_RE.exec(pathStr);
  if (m) {
    const sx = parseFloat(m[1]);
    const sy = parseFloat(m[2]);
    const cmd = m[3];
    const a = parseFloat(m[4]);
    const b = m[5] !== undefined ? parseFloat(m[5]) : 0;
    let ex = sx;
    let ey = sy;
    switch (cmd) {
      case 'h':
        ex = sx + a;
        break;
      case 'v':
        ey = sy + a;
        break;
      case 'H':
        ex = a;
        break;
      case 'V':
        ey = a;
        break;
      case 'l':
        ex = sx + a;
        ey = sy + b;
        break;
      case 'L':
        ex = a;
        ey = b;
        break;
    }
    const dStart = Math.hypot(sx - x, sy - y);
    const dEnd = Math.hypot(ex - x, ey - y);
    const far = dEnd >= dStart ? { x: ex, y: ey } : { x: sx, y: sy };
    dx = far.x - x;
    dy = far.y - y;
  }
  let rot: EagleRotation;
  let lengthPx: number;
  if (dx === 0 && dy === 0) {
    // No usable path: fall back to the rotation field (0 → body on the left of the pin).
    const r = num(rotField);
    rot = r === 180 ? 0 : r === 90 ? 270 : r === 270 ? 90 : 180;
    lengthPx = 10;
    warnings.warn('PIN_NO_PATH', `Pin ${number}: no pin path, assuming 2.54 mm length from rotation ${rotField}`, raw);
  } else {
    rot = Math.abs(dx) >= Math.abs(dy) ? (dx > 0 ? 0 : 180) : dy < 0 ? 90 : 270;
    lengthPx = Math.hypot(dx, dy);
  }
  const nameSec = (sections[3] ?? '').split('~');
  const numSec = (sections[4] ?? '').split('~');
  const dotSec = (sections[5] ?? '').split('~');
  const clkSec = (sections[6] ?? '').split('~');
  const name = (nameSec[4] ?? '').trim();
  const p = frame.pt(x, y);

  const pin: SymbolPin = {
    number,
    name: name || number,
    x: p.x,
    y: p.y,
    length: frame.len(lengthPx),
    rot,
    electric,
    nameVisible: nameSec[0] === '1',
    numberVisible: numSec[0] === '1',
    dot: dotSec[0] === '1',
    clock: clkSec[0] === '1',
    raw,
  };
  if (!number) {
    warnings.error('PIN_NO_NUMBER', `Pin "${name}" at (${p.x}, ${p.y}) has no pin number`, raw);
  }
  return pin;
}

function parseSymbolPrimitive(raw: string, frame: Frame, warnings: WarningCollector, unit: SymbolUnit): void {
  const f = raw.split('~');
  const type = f[0];
  switch (type) {
    case 'P': {
      const pin = parsePin(raw, frame, warnings);
      if (pin) unit.pins.push(pin);
      return;
    }
    case 'R': {
      // R~x~y~rx~ry~width~height~strokeColor~strokeWidth~strokeStyle~fillColor~id~locked
      const x = num(f[1]);
      const y = num(f[2]);
      const w = num(f[5]);
      const h = num(f[6]);
      if (num(f[3]) > 0 || num(f[4]) > 0) {
        warnings.info('RECT_CORNER_RADIUS', 'Rounded rectangle corners are drawn square in the symbol', raw);
      }
      const corners = [frame.pt(x, y), frame.pt(x + w, y), frame.pt(x + w, y + h), frame.pt(x, y + h)];
      pushClosedShape(unit.graphics, corners, isFilled(f[10]), raw);
      return;
    }
    case 'E': {
      // E~cx~cy~rx~ry~strokeColor~strokeWidth~strokeStyle~fillColor~id~locked
      const c = frame.pt(num(f[1]), num(f[2]));
      const rx = frame.len(num(f[3]));
      const ry = frame.len(num(f[4]));
      const filled = isFilled(f[8]);
      if (Math.abs(rx - ry) < 1e-6) {
        unit.graphics.push({ kind: 'circle', x: c.x, y: c.y, radius: rx, filled, raw });
      } else {
        warnings.warn('ELLIPSE_APPROXIMATED', 'Non-circular ellipse approximated with a 24-vertex polygon', raw);
        const pts: Point[] = [];
        for (let i = 0; i < 24; i++) {
          const t = (i / 24) * 2 * Math.PI;
          pts.push({ x: round(c.x + rx * Math.cos(t)), y: round(c.y + ry * Math.sin(t)) });
        }
        pushClosedShape(unit.graphics, pts, filled, raw);
      }
      return;
    }
    case 'PL':
    case 'PG': {
      // PL/PG~points~strokeColor~strokeWidth~strokeStyle~fillColor~id~locked
      const nums = parsePoints(f[1] ?? '');
      const pts: Point[] = [];
      for (let i = 0; i + 1 < nums.length; i += 2) pts.push(frame.pt(nums[i], nums[i + 1]));
      if (pts.length < 2) {
        warnings.warn('DEGENERATE_SHAPE', `${type} with fewer than two points dropped`, raw);
        return;
      }
      const filled = isFilled(f[5]);
      if (type === 'PG' || filled) {
        pushClosedShape(unit.graphics, pts, filled, raw);
      } else {
        for (let i = 0; i + 1 < pts.length; i++) {
          unit.graphics.push({ kind: 'wire', x1: pts[i].x, y1: pts[i].y, x2: pts[i + 1].x, y2: pts[i + 1].y, raw });
        }
      }
      return;
    }
    case 'A': {
      // A~path~helperDots~strokeColor~strokeWidth~strokeStyle~fillColor~id~locked
      pushPath(unit.graphics, f[1] ?? '', isFilled(f[6]), frame, warnings, raw);
      return;
    }
    case 'PT': {
      // PT~path~strokeColor~strokeWidth~strokeStyle~fillColor~id~locked
      pushPath(unit.graphics, f[1] ?? '', isFilled(f[5]), frame, warnings, raw);
      return;
    }
    case 'T': {
      // T~mark~x~y~rotation~color~fontFamily~fontSize~fontWeight~fontStyle~baseline~textType~text~visible~anchor~id~locked
      const p = frame.pt(num(f[2]), num(f[3]));
      const sizePt = num(f[7], 7);
      const anchorRaw = f[14] ?? 'start';
      const anchor = anchorRaw === 'middle' || anchorRaw === 'end' ? anchorRaw : 'start';
      if (f[13] === '0') return; // hidden text
      unit.graphics.push({
        kind: 'text',
        mark: f[1] ?? 'L',
        x: p.x,
        y: p.y,
        rot: eagleRotation(num(f[4])),
        size: round(sizePt * 0.254, 3),
        text: f[12] ?? '',
        anchor,
        raw,
      });
      return;
    }
    default:
      warnings.warn('UNMAPPED_SYMBOL_PRIMITIVE', `Symbol primitive "${type}" is not supported and was dropped`, raw);
  }
}

function pushClosedShape(out: SymbolGraphic[], pts: Point[], filled: boolean, raw: string): void {
  if (filled) {
    out.push({ kind: 'polygon', points: pts.map((p) => ({ x: p.x, y: p.y })), filled: true, raw });
    return;
  }
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % pts.length];
    if (a.x === b.x && a.y === b.y) continue;
    out.push({ kind: 'wire', x1: a.x, y1: a.y, x2: b.x, y2: b.y, raw });
  }
}

function pushPath(
  out: SymbolGraphic[],
  d: string,
  filled: boolean,
  frame: Frame,
  warnings: WarningCollector,
  raw: string,
): void {
  let subpaths: SubPath[];
  try {
    subpaths = parseSvgPath(d);
  } catch (e) {
    warnings.warn('BAD_SVG_PATH', `Could not parse SVG path: ${(e as Error).message}`, raw);
    return;
  }
  if (filled) {
    for (const sp of subpaths) out.push({ kind: 'polygon', points: subpathToVertices(sp, frame), filled: true, raw });
  } else {
    out.push(...subpathsToSymbolWires(subpaths, frame, raw));
  }
}

const onGrid = (v: number): boolean => Math.abs(v / SYMBOL_GRID_MM - Math.round(v / SYMBOL_GRID_MM)) < 1e-3;
/** Offset that moves `v` onto the grid. Exact half-grid values are always nudged upward so all pins agree. */
const gridOffset = (v: number): number => {
  const q = v / SYMBOL_GRID_MM;
  return round((Math.round(q + 1e-6) - q) * SYMBOL_GRID_MM);
};

function translateGraphic(g: SymbolGraphic, dx: number, dy: number): SymbolGraphic {
  switch (g.kind) {
    case 'wire':
      return { ...g, x1: round(g.x1 + dx), y1: round(g.y1 + dy), x2: round(g.x2 + dx), y2: round(g.y2 + dy) };
    case 'circle':
    case 'text':
      return { ...g, x: round(g.x + dx), y: round(g.y + dy) };
    case 'polygon':
      return { ...g, points: g.points.map((p) => ({ ...p, x: round(p.x + dx), y: round(p.y + dy) })) };
  }
}

/**
 * EasyEDA symbols often have their origin on a half-grid point, so every pin is off the 2.54 mm grid by
 * the same 1.27 mm. When all pins agree on one offset, the whole unit is shifted onto the grid; pins
 * that are still off-grid afterwards get a warning.
 */
export function snapUnitToGrid(unit: SymbolUnit, warnings: WarningCollector): void {
  if (unit.pins.length === 0) return;
  const first = unit.pins[0];
  const dx = gridOffset(first.x);
  const dy = gridOffset(first.y);
  const allAgree = unit.pins.every((p) => Math.abs(gridOffset(p.x) - dx) < 1e-3 && Math.abs(gridOffset(p.y) - dy) < 1e-3);
  if (allAgree && (dx !== 0 || dy !== 0)) {
    for (const p of unit.pins) {
      p.x = round(p.x + dx);
      p.y = round(p.y + dy);
    }
    unit.graphics = unit.graphics.map((g) => translateGraphic(g, dx, dy));
    warnings.info('SYMBOL_SHIFTED', `Symbol${unit.title ? ` unit ${unit.title}` : ''} shifted by (${dx}, ${dy}) mm to put its pins on the 2.54 mm grid`);
  }
  for (const p of unit.pins) {
    if (!onGrid(p.x) || !onGrid(p.y)) {
      warnings.warn('PIN_OFF_GRID', `Pin ${p.number} (${p.name}) at (${p.x}, ${p.y}) mm is off the 2.54 mm grid`, p.raw);
    }
  }
}

/** Parse one symbol document (`dataStr`) into a unit. */
export function parseSymbol(dataStr: RawDataStr, warnings: WarningCollector, title?: string): SymbolUnit {
  const frame = new Frame(num(String(dataStr.head?.x ?? 0)), num(String(dataStr.head?.y ?? 0)));
  const unit: SymbolUnit = { pins: [], graphics: [] };
  if (title) unit.title = title;
  for (const raw of splitShapes(dataStr.shape)) parseSymbolPrimitive(raw, frame, warnings, unit);
  snapUnitToGrid(unit, warnings);
  return unit;
}

// ---------------------------------------------------------------------------------------------
// Footprint
// ---------------------------------------------------------------------------------------------

/** Parse a PAD primitive. Exported for unit tests. */
export function parsePad(raw: string, frame: Frame, warnings: WarningCollector): Pad | null {
  const f = raw.split('~');
  // PAD~shape~x~y~width~height~layer~net~number~holeRadius~points~rotation~id~holeLength~holePoints~plated~locked~…
  const shapeRaw = (f[1] ?? '').toUpperCase();
  const shape: PadShape | null =
    shapeRaw === 'ELLIPSE' || shapeRaw === 'RECT' || shapeRaw === 'OVAL' || shapeRaw === 'POLYGON' ? shapeRaw : null;
  if (!shape) {
    warnings.error('PAD_UNKNOWN_SHAPE', `Pad shape "${f[1]}" is not supported`, raw);
    return null;
  }
  const cx = num(f[2]);
  const cy = num(f[3]);
  const c = frame.pt(cx, cy);
  const number = (f[8] ?? '').trim();
  const holeRadius = num(f[9]);
  const holeLength = num(f[13]);
  const nums = parsePoints(f[10] ?? '');
  const points: Point[] = [];
  for (let i = 0; i + 1 < nums.length; i += 2) points.push(frame.pt(nums[i], nums[i + 1]));

  let holeAngle = 0;
  if (holeLength > 0) {
    const hp = parsePoints(f[14] ?? '');
    if (hp.length >= 4) {
      const a = frame.pt(hp[0], hp[1]);
      const b = frame.pt(hp[2], hp[3]);
      holeAngle = round(((Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI + 360) % 180, 3);
    } else {
      holeAngle = num(f[4]) > num(f[5]) ? 0 : 90;
    }
  }
  if (!number) warnings.warn('PAD_NO_NUMBER', `Pad at (${c.x}, ${c.y}) has no number and cannot be connected`, raw);
  return {
    shape,
    x: c.x,
    y: c.y,
    width: frame.len(num(f[4])),
    height: frame.len(num(f[5])),
    layer: num(f[6]),
    number,
    holeDiameter: round(frame.len(holeRadius) * 2),
    holeLength: frame.len(holeLength),
    holeAngle,
    rotation: eagleRotation(num(f[11])),
    points,
    plated: (f[15] ?? 'Y').toUpperCase() !== 'N',
    raw,
  };
}

function parseFootprintPrimitive(raw: string, frame: Frame, warnings: WarningCollector, fp: Footprint): void {
  const f = raw.split('~');
  const type = f[0];
  switch (type) {
    case 'PAD': {
      const pad = parsePad(raw, frame, warnings);
      if (pad) fp.pads.push(pad);
      return;
    }
    case 'TRACK': {
      // TRACK~strokeWidth~layer~net~points~id~locked
      const width = frame.len(num(f[1]));
      const layer = num(f[2]);
      const nums = parsePoints(f[4] ?? '');
      for (let i = 0; i + 3 < nums.length; i += 2) {
        const a = frame.pt(nums[i], nums[i + 1]);
        const b = frame.pt(nums[i + 2], nums[i + 3]);
        fp.graphics.push({ kind: 'wire', x1: a.x, y1: a.y, x2: b.x, y2: b.y, width, layer, raw });
      }
      return;
    }
    case 'ARC': {
      // ARC~strokeWidth~layer~net~path~helperDots~id~locked
      const width = frame.len(num(f[1]));
      const layer = num(f[2]);
      let subpaths: SubPath[];
      try {
        subpaths = parseSvgPath(f[4] ?? '');
      } catch (e) {
        warnings.warn('BAD_SVG_PATH', `Could not parse ARC path: ${(e as Error).message}`, raw);
        return;
      }
      for (const sp of subpaths) {
        for (const seg of sp.segments) {
          const a = frame.pt(seg.from.x, seg.from.y);
          const b = frame.pt(seg.to.x, seg.to.y);
          const wire: FootprintGraphic = { kind: 'wire', x1: a.x, y1: a.y, x2: b.x, y2: b.y, width, layer, raw };
          if (seg.type === 'arc') wire.curve = flipSweep(seg.sweep);
          fp.graphics.push(wire);
        }
      }
      return;
    }
    case 'CIRCLE': {
      // CIRCLE~cx~cy~r~strokeWidth~layer~id~locked
      const c = frame.pt(num(f[1]), num(f[2]));
      fp.graphics.push({ kind: 'circle', x: c.x, y: c.y, radius: frame.len(num(f[3])), width: frame.len(num(f[4])), layer: num(f[5]), raw });
      return;
    }
    case 'RECT': {
      // Observed: RECT~x~y~width~height~layer~id~locked~strokeWidth~fill (differs from the brief; see AGENTS.md)
      const x = num(f[1]);
      const y = num(f[2]);
      const w = num(f[3]);
      const h = num(f[4]);
      const a = frame.pt(x, y + h);
      const b = frame.pt(x + w, y);
      fp.graphics.push({
        kind: 'rect',
        x1: a.x,
        y1: a.y,
        x2: b.x,
        y2: b.y,
        width: frame.len(num(f[8], 1)),
        layer: num(f[5]),
        filled: isFilled(f[9]),
        raw,
      });
      return;
    }
    case 'HOLE': {
      // HOLE~cx~cy~r~id~locked
      const c = frame.pt(num(f[1]), num(f[2]));
      fp.graphics.push({ kind: 'hole', x: c.x, y: c.y, drill: round(frame.len(num(f[3])) * 2), raw });
      return;
    }
    case 'SOLIDREGION': {
      // SOLIDREGION~layer~net~path~type~id~locked
      const layer = num(f[1]);
      const regionType = f[4] ?? 'solid';
      let subpaths: SubPath[];
      try {
        subpaths = parseSvgPath(f[3] ?? '');
      } catch (e) {
        warnings.warn('BAD_SVG_PATH', `Could not parse SOLIDREGION path: ${(e as Error).message}`, raw);
        return;
      }
      for (const sp of subpaths) {
        const points = subpathToVertices(sp, frame);
        if (points.length < 3) {
          warnings.warn('DEGENERATE_SHAPE', 'SOLIDREGION with fewer than three vertices dropped', raw);
          continue;
        }
        fp.graphics.push({ kind: 'polygon', points, layer, regionType, raw });
      }
      return;
    }
    case 'TEXT': {
      // TEXT~type~x~y~strokeWidth~rotation~mirror~layer~net~fontSize~text~path~display~id~font~locked
      if (f[12] === 'none') return;
      const p = frame.pt(num(f[2]), num(f[3]));
      fp.graphics.push({
        kind: 'text',
        textType: f[1] ?? 'L',
        x: p.x,
        y: p.y,
        rot: eagleRotation(num(f[5])),
        mirror: f[6] === '1',
        layer: num(f[7]),
        size: frame.len(num(f[9], 5)),
        width: frame.len(num(f[4], 0.8)),
        text: f[10] ?? '',
        raw,
      });
      return;
    }
    case 'SVGNODE':
      return; // 3D model reference; out of scope for v1 (documented in AGENTS.md)
    default:
      warnings.warn('UNMAPPED_FOOTPRINT_PRIMITIVE', `Footprint primitive "${type}" is not supported and was dropped`, raw);
  }
}

/** Parse one footprint document (`packageDetail.dataStr`). */
export function parseFootprint(title: string, dataStr: RawDataStr, warnings: WarningCollector): Footprint {
  const frame = new Frame(num(String(dataStr.head?.x ?? 0)), num(String(dataStr.head?.y ?? 0)));
  const fp: Footprint = { title, pads: [], graphics: [] };
  for (const raw of splitShapes(dataStr.shape)) parseFootprintPrimitive(raw, frame, warnings, fp);
  if (fp.pads.length === 0) warnings.error('NO_PADS', 'Footprint has no pads');
  return fp;
}

// ---------------------------------------------------------------------------------------------
// Whole component
// ---------------------------------------------------------------------------------------------

/** Strip a trailing CJK parenthetical such as `YAGEO(国巨)` → `YAGEO`. */
export function cleanManufacturer(s: string | undefined): string | undefined {
  if (!s) return undefined;
  const cleaned = s.replace(/\s*[(（][^()（）]*[㐀-鿿][^()（）]*[)）]\s*/g, '').trim();
  return cleaned || s.trim();
}

/**
 * Convert the parsed `components` API JSON to the part model.
 * Throws EasyEdaError for API failures and non-importable parts.
 */
export function parseComponent(json: unknown, requestedId: string): PartModel {
  const res = json as ComponentResponse | null;
  if (!res || typeof res !== 'object' || typeof res.success !== 'boolean') {
    throw new EasyEdaError('INVALID_RESPONSE', 'Unexpected response from EasyEDA (not a component JSON)');
  }
  if (!res.success) {
    const msg = res.message ?? 'unknown error';
    throw new EasyEdaError(res.code === 404 ? 'NOT_FOUND' : 'INVALID_RESPONSE', `EasyEDA: ${msg} (${requestedId})`);
  }
  const r = res.result;
  if (!r || typeof r !== 'object') throw new EasyEdaError('INVALID_RESPONSE', 'EasyEDA response has no result');

  const warnings = new WarningCollector();
  const cpara = r.dataStr?.head?.c_para ?? {};

  // Symbol units
  const units: SymbolUnit[] = [];
  const subKeys = r.subparts ? Object.keys(r.subparts).sort((a, b) => Number(a) - Number(b)) : [];
  if (subKeys.length > 0) {
    for (const k of subKeys) {
      const sub = r.subparts![k];
      if (!sub?.dataStr) continue;
      units.push(parseSymbol(sub.dataStr, warnings, sub.title));
    }
    if (units.length > 1) warnings.info('MULTI_UNIT', `Part has ${units.length} units; one gate per unit (A, B, …)`);
  } else if (r.dataStr && (r.dataStr.shape?.length ?? 0) > 0) {
    units.push(parseSymbol(r.dataStr, warnings));
  }
  if (units.length === 0 || units.every((u) => u.pins.length === 0)) {
    throw new EasyEdaError(
      'NOT_IMPORTABLE',
      `${requestedId} has no schematic symbol data in the EasyEDA Standard API (probably an EasyEDA-Pro-only part)`,
    );
  }

  // Footprint
  const pkg = r.packageDetail;
  if (!pkg?.dataStr || (pkg.dataStr.shape?.length ?? 0) === 0) {
    throw new EasyEdaError('NOT_IMPORTABLE', `${requestedId} has no footprint data (packageDetail.dataStr missing)`);
  }
  const footprint = parseFootprint(pkg.title ?? cpara.package ?? 'UNNAMED', pkg.dataStr, warnings);

  const prefixRaw = (cpara.pre ?? '').replace(/\?/g, '').trim();
  const info: PartInfo = {
    lcsc: r.lcsc?.number ?? r.szlcsc?.number ?? cpara['Supplier Part'] ?? requestedId,
    title: r.title ?? cpara.name ?? requestedId,
    description: r.description ?? '',
    packageName: pkg.title ?? cpara.package ?? 'UNNAMED',
    prefix: prefixRaw || 'U',
    tags: r.tags ?? [],
  };
  const manufacturer = cleanManufacturer(cpara.Manufacturer);
  if (manufacturer) info.manufacturer = manufacturer;
  const mpn = cpara['Manufacturer Part']?.trim();
  if (mpn) info.mpn = mpn;
  const url = r.lcsc?.url ?? r.szlcsc?.url;
  if (url) info.productUrl = url;
  if (cpara['JLCPCB Part Class']) info.jlcClass = cpara['JLCPCB Part Class'];

  return { info, units, footprint, warnings: warnings.items };
}
