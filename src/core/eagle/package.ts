/** Emit an Eagle `<package>` from the footprint model. */

import type { Footprint, FootprintGraphic, Pad, Vertex } from '../easyeda/types.ts';
import { DROPPED_FOOTPRINT_LAYERS, EAGLE, EASYEDA_LAYER_NAMES, EASYEDA_MULTILAYER, FOOTPRINT_LAYER_MAP, round } from '../units.ts';
import type { WarningCollector } from '../warnings.ts';
import { dedupeNames } from './names.ts';
import { el, type XmlEl } from './xml.ts';

/** Outline width used for polygons converted from EasyEDA solid regions (1 mil). */
export const REGION_WIDTH = 0.0254;
export const PACKAGE_TEXT_SIZE = 1.27;

export interface EmittedPackage {
  element: XmlEl;
  /** Final (unique) pad names in the order of `footprint.pads`. */
  padNames: string[];
}

interface BBox {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

function grow(b: BBox, x: number, y: number): void {
  b.minX = Math.min(b.minX, x);
  b.minY = Math.min(b.minY, y);
  b.maxX = Math.max(b.maxX, x);
  b.maxY = Math.max(b.maxY, y);
}

const rotAttr = (deg: number): string | undefined => (deg === 0 ? undefined : `R${round(deg, 3)}`);

function mapLayer(layer: number, warnings: WarningCollector, raw: string): number | null {
  if (DROPPED_FOOTPRINT_LAYERS.has(layer)) return null;
  const mapped = FOOTPRINT_LAYER_MAP[layer];
  if (mapped !== undefined) return mapped;
  warnings.warn('UNMAPPED_LAYER', `EasyEDA layer ${layer} (${EASYEDA_LAYER_NAMES[layer] ?? 'unknown'}) has no Eagle equivalent; drawn on tDocu (51)`, raw);
  return EAGLE.TDOCU;
}

function vertices(points: Vertex[]): XmlEl[] {
  return points.map((p) => el('vertex', { x: p.x, y: p.y, curve: p.curve }));
}

function emitPad(pad: Pad, name: string, out: XmlEl[], warnings: WarningCollector): void {
  const isTht = pad.holeDiameter > 0 || pad.layer === EASYEDA_MULTILAYER;
  if (!isTht) {
    const layer = pad.layer === 2 ? EAGLE.BOTTOM : EAGLE.TOP;
    if (pad.layer !== 1 && pad.layer !== 2) {
      warnings.warn('PAD_LAYER', `Pad ${name}: SMD pad on EasyEDA layer ${pad.layer}; placed on Top`, pad.raw);
    }
    const roundness = pad.shape === 'RECT' || pad.shape === 'POLYGON' ? 0 : 100;
    out.push(el('smd', { name, x: pad.x, y: pad.y, dx: pad.width, dy: pad.height, layer, roundness, rot: rotAttr(pad.rotation) }));
    if (pad.shape === 'POLYGON') {
      if (pad.points.length >= 3) {
        out.push(el('polygon', { width: REGION_WIDTH, layer }, vertices(pad.points)));
      }
      warnings.warn('POLYGON_PAD', `Pad ${name}: polygon pad emitted as its bounding-box SMD plus a copper polygon; check it in Fusion`, pad.raw);
    }
    return;
  }

  // Through-hole
  if (pad.holeDiameter <= 0) {
    warnings.error('PAD_NO_DRILL', `Pad ${name}: multi-layer pad without a hole`, pad.raw);
    return;
  }
  if (!pad.plated) {
    warnings.warn('PAD_NOT_PLATED', `Pad ${name}: non-plated pad emitted as a plain hole (not connectable)`, pad.raw);
    out.push(el('hole', { x: pad.x, y: pad.y, drill: pad.holeDiameter }));
    return;
  }
  const w = pad.width;
  const h = pad.height;
  const long = Math.max(w, h);
  const short = Math.min(w, h);
  let shape: 'round' | 'square' | 'long' | 'octagon' = 'round';
  let diameter = long;
  let rot = pad.rotation;
  switch (pad.shape) {
    case 'ELLIPSE':
      shape = 'round';
      if (Math.abs(w - h) > 1e-6) warnings.warn('PAD_ASPECT', `Pad ${name}: elliptical THT pad ${w}×${h} emitted as round ⌀${long}`, pad.raw);
      break;
    case 'RECT':
      shape = 'square';
      if (Math.abs(w - h) > 1e-6) warnings.warn('PAD_ASPECT', `Pad ${name}: rectangular THT pad ${w}×${h} emitted as square ${long}`, pad.raw);
      break;
    case 'OVAL':
      shape = 'long';
      diameter = short; // Eagle's long pad is 2:1 with `diameter` = the short axis
      if (Math.abs(long / short - 2) > 0.05) {
        warnings.warn('PAD_ASPECT', `Pad ${name}: oval THT pad ${w}×${h} is not 2:1; Eagle long pad will be ${round(short * 2)}×${short}`, pad.raw);
      }
      if (h > w) rot = (rot + 90) % 360;
      break;
    case 'POLYGON':
      shape = 'octagon';
      warnings.warn('POLYGON_PAD', `Pad ${name}: polygon THT pad emitted as octagon ⌀${long}`, pad.raw);
      break;
  }
  if (pad.holeLength > pad.holeDiameter) {
    // Slot: Eagle has no slotted pads. Emit a long pad plus a Milling-layer wire that describes the slot.
    if (shape !== 'long') {
      shape = 'long';
      diameter = short;
      if (h > w) rot = (pad.rotation + 90) % 360;
    }
    const half = (pad.holeLength - pad.holeDiameter) / 2;
    const a = (pad.holeAngle * Math.PI) / 180;
    out.push(el('pad', { name, x: pad.x, y: pad.y, drill: pad.holeDiameter, diameter, shape, rot: rotAttr(rot) }));
    out.push(
      el('wire', {
        x1: round(pad.x - half * Math.cos(a)),
        y1: round(pad.y - half * Math.sin(a)),
        x2: round(pad.x + half * Math.cos(a)),
        y2: round(pad.y + half * Math.sin(a)),
        width: pad.holeDiameter,
        layer: EAGLE.MILLING,
      }),
    );
    warnings.warn('SLOT_PAD', `Pad ${name}: slot ${pad.holeLength}×${pad.holeDiameter} mm emitted as a long pad with a Milling (46) wire; Fusion cannot drill slots from pads`, pad.raw);
    return;
  }
  out.push(el('pad', { name, x: pad.x, y: pad.y, drill: pad.holeDiameter, diameter, shape: shape === 'round' ? undefined : shape, rot: rotAttr(rot) }));
}

function emitGraphic(g: FootprintGraphic, out: XmlEl[], warnings: WarningCollector, bbox: BBox, hasName: { v: boolean }): void {
  switch (g.kind) {
    case 'wire': {
      const layer = mapLayer(g.layer, warnings, g.raw);
      if (layer === null) return;
      out.push(el('wire', { x1: g.x1, y1: g.y1, x2: g.x2, y2: g.y2, width: g.width, layer, curve: g.curve }));
      grow(bbox, g.x1, g.y1);
      grow(bbox, g.x2, g.y2);
      return;
    }
    case 'circle': {
      const layer = mapLayer(g.layer, warnings, g.raw);
      if (layer === null) return;
      // width 0 would be a filled disc in Eagle; keep EasyEDA's hairline circles as outlines
      out.push(el('circle', { x: g.x, y: g.y, radius: g.radius, width: g.width > 0 ? g.width : REGION_WIDTH, layer }));
      grow(bbox, g.x - g.radius, g.y - g.radius);
      grow(bbox, g.x + g.radius, g.y + g.radius);
      return;
    }
    case 'rect': {
      const layer = mapLayer(g.layer, warnings, g.raw);
      if (layer === null) return;
      if (g.filled) {
        out.push(el('rectangle', { x1: g.x1, y1: g.y1, x2: g.x2, y2: g.y2, layer }));
      } else {
        const c = [
          [g.x1, g.y1, g.x2, g.y1],
          [g.x2, g.y1, g.x2, g.y2],
          [g.x2, g.y2, g.x1, g.y2],
          [g.x1, g.y2, g.x1, g.y1],
        ];
        for (const [x1, y1, x2, y2] of c) out.push(el('wire', { x1, y1, x2, y2, width: g.width, layer }));
      }
      grow(bbox, g.x1, g.y1);
      grow(bbox, g.x2, g.y2);
      return;
    }
    case 'polygon': {
      const layer = mapLayer(g.layer, warnings, g.raw);
      if (layer === null) return;
      if (layer === EAGLE.TOP || layer === EAGLE.BOTTOM) {
        // Region types only matter on copper (cutout = copper removal, npth = non-plated hole).
        if (g.regionType !== 'solid') {
          warnings.warn('REGION_TYPE', `Copper region of type "${g.regionType}" has no Eagle equivalent; emitted as a plain polygon`, g.raw);
        } else {
          warnings.warn('COPPER_REGION', 'Copper solid region emitted as an unconnected package polygon', g.raw);
        }
      }
      out.push(el('polygon', { width: REGION_WIDTH, layer }, vertices(g.points)));
      for (const p of g.points) grow(bbox, p.x, p.y);
      return;
    }
    case 'hole':
      out.push(el('hole', { x: g.x, y: g.y, drill: g.drill }));
      grow(bbox, g.x - g.drill / 2, g.y - g.drill / 2);
      grow(bbox, g.x + g.drill / 2, g.y + g.drill / 2);
      return;
    case 'text': {
      const isName = g.textType === 'N' || g.textType === 'P';
      let layer: number | null;
      if (isName) layer = EAGLE.TNAMES;
      else layer = mapLayer(g.layer, warnings, g.raw);
      if (layer === null) return;
      const rot = (g.mirror ? 'M' : '') + `R${round(g.rot, 3)}`;
      out.push(el('text', { x: g.x, y: g.y, size: g.size, layer, rot: rot === 'R0' ? undefined : rot }, [isName ? '>NAME' : g.text]));
      if (isName) hasName.v = true;
      return;
    }
  }
}

export function emitPackage(footprint: Footprint, name: string, warnings: WarningCollector): EmittedPackage {
  const children: XmlEl[] = [el('description', {}, [`<b>${footprint.title}</b><br>\nImported from EasyEDA/LCSC`])];
  const bbox: BBox = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };

  const padNames = dedupeNames(
    footprint.pads.map((p) => p.number || '0'),
    '_',
  );
  footprint.pads.forEach((p, i) => {
    if (padNames[i] !== p.number) warnings.warn('DUPLICATE_PAD_NUMBER', `Pad number "${p.number}" occurs more than once; renamed to ${padNames[i]}`, p.raw);
  });

  const padEls: XmlEl[] = [];
  footprint.pads.forEach((p, i) => {
    emitPad(p, padNames[i], padEls, warnings);
    const r = Math.max(p.width, p.height) / 2;
    grow(bbox, p.x - r, p.y - r);
    grow(bbox, p.x + r, p.y + r);
  });

  const graphicEls: XmlEl[] = [];
  const hasName = { v: false };
  for (const g of footprint.graphics) emitGraphic(g, graphicEls, warnings, bbox, hasName);

  if (!Number.isFinite(bbox.minX)) Object.assign(bbox, { minX: -1, minY: -1, maxX: 1, maxY: 1 });
  const cx = round((bbox.minX + bbox.maxX) / 2, 1);
  const textEls: XmlEl[] = [];
  if (!hasName.v) {
    textEls.push(el('text', { x: cx, y: round(bbox.maxY + 0.5, 2), size: PACKAGE_TEXT_SIZE, layer: EAGLE.TNAMES, align: 'bottom-center' }, ['>NAME']));
  }
  textEls.push(el('text', { x: cx, y: round(bbox.minY - 0.5, 2), size: PACKAGE_TEXT_SIZE, layer: EAGLE.TVALUES, align: 'top-center' }, ['>VALUE']));

  children.push(...padEls, ...graphicEls, ...textEls);
  return { element: el('package', { name }, children), padNames };
}
