/**
 * Typed intermediate model produced from the EasyEDA API JSON.
 *
 * All coordinates are already converted: origin subtracted, scaled to millimetres, Y axis pointing up
 * (Eagle convention). Arc `curve` values follow Eagle's convention as well: degrees, positive =
 * counter-clockwise from the start point to the end point.
 */

import type { ConversionWarning } from '../warnings.ts';

export interface Point {
  x: number;
  y: number;
}

export interface Vertex extends Point {
  /** Eagle-style curve (degrees, CCW positive) of the segment starting at this vertex. */
  curve?: number;
}

export type EagleRotation = 0 | 90 | 180 | 270;

// ---------------------------------------------------------------------------------------------
// Symbol
// ---------------------------------------------------------------------------------------------

/** EasyEDA `electric` field. 0 undefined, 1 input, 2 output, 3 bidirectional, 4 power. */
export type PinElectric = 0 | 1 | 2 | 3 | 4;

export interface SymbolPin {
  /** EasyEDA pin number (matched against footprint pad numbers). */
  number: string;
  /** EasyEDA pin name; falls back to the number when empty. */
  name: string;
  /** Connection point. */
  x: number;
  y: number;
  /** Pin length in mm (from the pin path). */
  length: number;
  /** Eagle rotation: direction from the connection point toward the body. */
  rot: EagleRotation;
  electric: PinElectric;
  nameVisible: boolean;
  numberVisible: boolean;
  dot: boolean;
  clock: boolean;
  raw: string;
}

export type TextMark = 'N' | 'P' | 'V' | 'L' | string;

export type SymbolGraphic =
  | { kind: 'wire'; x1: number; y1: number; x2: number; y2: number; curve?: number; raw: string }
  | { kind: 'circle'; x: number; y: number; radius: number; filled: boolean; raw: string }
  | { kind: 'polygon'; points: Vertex[]; filled: boolean; raw: string }
  | {
      kind: 'text';
      mark: TextMark;
      x: number;
      y: number;
      rot: number;
      size: number;
      text: string;
      anchor: 'start' | 'middle' | 'end';
      raw: string;
    };

export interface SymbolUnit {
  /** Sub-part title from EasyEDA (multi-unit parts), undefined for single-unit parts. */
  title?: string;
  pins: SymbolPin[];
  graphics: SymbolGraphic[];
}

// ---------------------------------------------------------------------------------------------
// Footprint
// ---------------------------------------------------------------------------------------------

export type PadShape = 'ELLIPSE' | 'RECT' | 'OVAL' | 'POLYGON';

export interface Pad {
  shape: PadShape;
  x: number;
  y: number;
  width: number;
  height: number;
  /** EasyEDA layer id: 1 top, 2 bottom, 11 multi-layer (THT). */
  layer: number;
  number: string;
  /** Hole diameter in mm; 0 for SMD pads. */
  holeDiameter: number;
  /** Total slot length in mm; 0 when the hole is round. */
  holeLength: number;
  /** Slot direction in degrees (Eagle convention) when holeLength > 0. */
  holeAngle: number;
  /** Rotation in degrees, Eagle convention (CCW positive). */
  rotation: number;
  /** Outline points for POLYGON pads (also present for RECT pads). */
  points: Point[];
  plated: boolean;
  raw: string;
}

export type FootprintGraphic =
  | {
      kind: 'wire';
      x1: number;
      y1: number;
      x2: number;
      y2: number;
      width: number;
      layer: number;
      curve?: number;
      raw: string;
    }
  | { kind: 'circle'; x: number; y: number; radius: number; width: number; layer: number; raw: string }
  | { kind: 'polygon'; points: Vertex[]; layer: number; regionType: string; raw: string }
  | {
      kind: 'rect';
      x1: number;
      y1: number;
      x2: number;
      y2: number;
      width: number;
      layer: number;
      filled: boolean;
      raw: string;
    }
  | { kind: 'hole'; x: number; y: number; drill: number; raw: string }
  | {
      kind: 'text';
      textType: string;
      x: number;
      y: number;
      rot: number;
      mirror: boolean;
      layer: number;
      size: number;
      width: number;
      text: string;
      raw: string;
    };

export interface Footprint {
  /** Raw EasyEDA package title, e.g. `SOT-23-3_L2.9-W1.3-P1.90-LS2.4-BR`. */
  title: string;
  pads: Pad[];
  graphics: FootprintGraphic[];
}

// ---------------------------------------------------------------------------------------------
// Part
// ---------------------------------------------------------------------------------------------

export interface PartInfo {
  lcsc: string;
  title: string;
  description: string;
  /** EasyEDA package name from `packageDetail.title`. */
  packageName: string;
  manufacturer?: string;
  mpn?: string;
  /** Designator prefix without the `?`, e.g. `C`. */
  prefix: string;
  /** EasyEDA category tags. */
  tags: string[];
  /** LCSC product page. The API does not expose a datasheet URL. */
  productUrl?: string;
  /** `Basic Part` / `Extended Part` at JLCPCB when known. */
  jlcClass?: string;
}

export interface PartModel {
  info: PartInfo;
  units: SymbolUnit[];
  footprint: Footprint;
  warnings: ConversionWarning[];
}
