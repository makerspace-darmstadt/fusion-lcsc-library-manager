/**
 * Minimal SVG path parser for the subset EasyEDA emits: M, L, H, V, Z, A, C, Q (absolute and relative).
 *
 * Output is a list of sub-paths made of segments in the *input* coordinate system (canvas px, Y down).
 * Circular arcs are kept as arcs (with the SVG-frame sweep angle); elliptical arcs and Bézier curves
 * are flattened to line segments.
 */

export interface PathPoint {
  x: number;
  y: number;
}

export type PathSegment =
  | { type: 'line'; from: PathPoint; to: PathPoint }
  | {
      type: 'arc';
      from: PathPoint;
      to: PathPoint;
      center: PathPoint;
      radius: number;
      /** Sweep in degrees in the SVG (Y-down) frame; positive = SVG sweep-flag 1 (clockwise on screen). */
      sweep: number;
    };

export interface SubPath {
  segments: PathSegment[];
  closed: boolean;
}

const TOKEN = /[A-Za-z]|-?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?/g;

function tokenize(d: string): string[] {
  return d.match(TOKEN) ?? [];
}

/** Compute the centre parameterisation of an SVG arc (spec F.6.5). Returns null for degenerate arcs. */
export function arcCenter(
  p1: PathPoint,
  p2: PathPoint,
  rxIn: number,
  ryIn: number,
  phiDeg: number,
  largeArc: boolean,
  sweepFlag: boolean,
): { cx: number; cy: number; rx: number; ry: number; theta1: number; delta: number } | null {
  let rx = Math.abs(rxIn);
  let ry = Math.abs(ryIn);
  if (rx === 0 || ry === 0) return null;
  if (p1.x === p2.x && p1.y === p2.y) return null;
  const phi = (phiDeg * Math.PI) / 180;
  const cosPhi = Math.cos(phi);
  const sinPhi = Math.sin(phi);
  const dx2 = (p1.x - p2.x) / 2;
  const dy2 = (p1.y - p2.y) / 2;
  const x1p = cosPhi * dx2 + sinPhi * dy2;
  const y1p = -sinPhi * dx2 + cosPhi * dy2;
  const lambda = (x1p * x1p) / (rx * rx) + (y1p * y1p) / (ry * ry);
  if (lambda > 1) {
    const s = Math.sqrt(lambda);
    rx *= s;
    ry *= s;
  }
  const rx2 = rx * rx;
  const ry2 = ry * ry;
  const num = rx2 * ry2 - rx2 * y1p * y1p - ry2 * x1p * x1p;
  const den = rx2 * y1p * y1p + ry2 * x1p * x1p;
  const coef = (largeArc !== sweepFlag ? 1 : -1) * Math.sqrt(Math.max(0, num / den));
  const cxp = (coef * rx * y1p) / ry;
  const cyp = (-coef * ry * x1p) / rx;
  const cx = cosPhi * cxp - sinPhi * cyp + (p1.x + p2.x) / 2;
  const cy = sinPhi * cxp + cosPhi * cyp + (p1.y + p2.y) / 2;
  const ux = (x1p - cxp) / rx;
  const uy = (y1p - cyp) / ry;
  const vx = (-x1p - cxp) / rx;
  const vy = (-y1p - cyp) / ry;
  const angle = (ax: number, ay: number, bx: number, by: number) => {
    const dot = ax * bx + ay * by;
    const len = Math.hypot(ax, ay) * Math.hypot(bx, by);
    let a = Math.acos(Math.max(-1, Math.min(1, dot / len)));
    if (ax * by - ay * bx < 0) a = -a;
    return a;
  };
  const theta1 = angle(1, 0, ux, uy);
  let delta = angle(ux, uy, vx, vy);
  if (!sweepFlag && delta > 0) delta -= 2 * Math.PI;
  if (sweepFlag && delta < 0) delta += 2 * Math.PI;
  return { cx, cy, rx, ry, theta1: (theta1 * 180) / Math.PI, delta: (delta * 180) / Math.PI };
}

function flattenArc(
  from: PathPoint,
  c: { cx: number; cy: number; rx: number; ry: number; theta1: number; delta: number },
  phiDeg: number,
  to: PathPoint,
  out: PathSegment[],
): void {
  const steps = Math.max(2, Math.ceil(Math.abs(c.delta) / 15));
  const phi = (phiDeg * Math.PI) / 180;
  let prev = from;
  for (let i = 1; i <= steps; i++) {
    const t = ((c.theta1 + (c.delta * i) / steps) * Math.PI) / 180;
    const ex = c.rx * Math.cos(t);
    const ey = c.ry * Math.sin(t);
    const p: PathPoint =
      i === steps
        ? to
        : { x: c.cx + ex * Math.cos(phi) - ey * Math.sin(phi), y: c.cy + ex * Math.sin(phi) + ey * Math.cos(phi) };
    out.push({ type: 'line', from: prev, to: p });
    prev = p;
  }
}

function flattenCubic(p0: PathPoint, p1: PathPoint, p2: PathPoint, p3: PathPoint, out: PathSegment[]): void {
  const steps = 8;
  let prev = p0;
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    const mt = 1 - t;
    const p = {
      x: mt * mt * mt * p0.x + 3 * mt * mt * t * p1.x + 3 * mt * t * t * p2.x + t * t * t * p3.x,
      y: mt * mt * mt * p0.y + 3 * mt * mt * t * p1.y + 3 * mt * t * t * p2.y + t * t * t * p3.y,
    };
    out.push({ type: 'line', from: prev, to: p });
    prev = p;
  }
}

/** Parse an SVG path `d` string into sub-paths. Throws on malformed input. */
export function parseSvgPath(d: string): SubPath[] {
  const tokens = tokenize(d);
  const subpaths: SubPath[] = [];
  let current: SubPath | null = null;
  let pos: PathPoint = { x: 0, y: 0 };
  let start: PathPoint = { x: 0, y: 0 };
  let lastCtrl: PathPoint | null = null;
  let cmd = '';
  let i = 0;

  const num = (): number => {
    const t = tokens[i++];
    if (t === undefined || /[A-Za-z]/.test(t)) throw new Error(`SVG path: expected number in "${d}"`);
    return parseFloat(t);
  };
  const ensure = (): SubPath => {
    if (!current) {
      current = { segments: [], closed: false };
      subpaths.push(current);
    }
    return current;
  };
  const lineTo = (p: PathPoint) => {
    ensure().segments.push({ type: 'line', from: pos, to: p });
    pos = p;
  };

  while (i < tokens.length) {
    const t = tokens[i];
    if (/[A-Za-z]/.test(t)) {
      cmd = t;
      i++;
    } else if (cmd === '') {
      throw new Error(`SVG path: number before command in "${d}"`);
    } else if (cmd === 'M') {
      cmd = 'L'; // implicit lineto after moveto
    } else if (cmd === 'm') {
      cmd = 'l';
    }
    const rel = cmd === cmd.toLowerCase();
    const base = rel ? pos : { x: 0, y: 0 };
    switch (cmd.toUpperCase()) {
      case 'M': {
        const p = { x: base.x + num(), y: base.y + num() };
        current = { segments: [], closed: false };
        subpaths.push(current);
        pos = p;
        start = p;
        lastCtrl = null;
        break;
      }
      case 'L':
        lineTo({ x: base.x + num(), y: base.y + num() });
        lastCtrl = null;
        break;
      case 'H':
        lineTo({ x: base.x + num(), y: pos.y });
        lastCtrl = null;
        break;
      case 'V':
        lineTo({ x: pos.x, y: base.y + num() });
        lastCtrl = null;
        break;
      case 'Z': {
        const sp = ensure();
        if (pos.x !== start.x || pos.y !== start.y) sp.segments.push({ type: 'line', from: pos, to: start });
        sp.closed = true;
        pos = start;
        current = null;
        lastCtrl = null;
        break;
      }
      case 'A': {
        const rx = num();
        const ry = num();
        const phi = num();
        const large = num() !== 0;
        const sweep = num() !== 0;
        const to = { x: base.x + num(), y: base.y + num() };
        const sp = ensure();
        const c = arcCenter(pos, to, rx, ry, phi, large, sweep);
        if (!c) {
          if (pos.x !== to.x || pos.y !== to.y) sp.segments.push({ type: 'line', from: pos, to });
        } else if (Math.abs(c.rx - c.ry) < 1e-6) {
          sp.segments.push({ type: 'arc', from: pos, to, center: { x: c.cx, y: c.cy }, radius: c.rx, sweep: c.delta });
        } else {
          flattenArc(pos, c, phi, to, sp.segments);
        }
        pos = to;
        lastCtrl = null;
        break;
      }
      case 'C': {
        const p1 = { x: base.x + num(), y: base.y + num() };
        const p2 = { x: base.x + num(), y: base.y + num() };
        const p3 = { x: base.x + num(), y: base.y + num() };
        flattenCubic(pos, p1, p2, p3, ensure().segments);
        pos = p3;
        lastCtrl = p2;
        break;
      }
      case 'S': {
        const p1: PathPoint = lastCtrl ? { x: 2 * pos.x - lastCtrl.x, y: 2 * pos.y - lastCtrl.y } : pos;
        const p2 = { x: base.x + num(), y: base.y + num() };
        const p3 = { x: base.x + num(), y: base.y + num() };
        flattenCubic(pos, p1, p2, p3, ensure().segments);
        pos = p3;
        lastCtrl = p2;
        break;
      }
      case 'Q': {
        const q1 = { x: base.x + num(), y: base.y + num() };
        const p3 = { x: base.x + num(), y: base.y + num() };
        const p1 = { x: pos.x + (2 / 3) * (q1.x - pos.x), y: pos.y + (2 / 3) * (q1.y - pos.y) };
        const p2 = { x: p3.x + (2 / 3) * (q1.x - p3.x), y: p3.y + (2 / 3) * (q1.y - p3.y) };
        flattenCubic(pos, p1, p2, p3, ensure().segments);
        pos = p3;
        lastCtrl = q1;
        break;
      }
      case 'T': {
        const q1: PathPoint = lastCtrl ? { x: 2 * pos.x - lastCtrl.x, y: 2 * pos.y - lastCtrl.y } : pos;
        const p3 = { x: base.x + num(), y: base.y + num() };
        const p1 = { x: pos.x + (2 / 3) * (q1.x - pos.x), y: pos.y + (2 / 3) * (q1.y - pos.y) };
        const p2 = { x: p3.x + (2 / 3) * (q1.x - p3.x), y: p3.y + (2 / 3) * (q1.y - p3.y) };
        flattenCubic(pos, p1, p2, p3, ensure().segments);
        pos = p3;
        lastCtrl = q1;
        break;
      }
      default:
        throw new Error(`SVG path: unsupported command "${cmd}" in "${d}"`);
    }
  }
  return subpaths.filter((sp) => sp.segments.length > 0);
}
