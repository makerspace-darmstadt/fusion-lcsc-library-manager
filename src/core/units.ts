/**
 * Unit and layer mapping constants shared by the EasyEDA parser and the Eagle emitter.
 *
 * EasyEDA canvas units: 1 px = 10 mil = 0.254 mm (symbols and footprints alike).
 * EasyEDA's Y axis points down; Eagle's points up.
 */

export const MM_PER_PX = 0.254;
export const MIL_PER_PX = 10;

/** Eagle/Fusion symbol grid: 0.1 in. EasyEDA pins sit on 10 px = 100 mil, which is the same grid. */
export const SYMBOL_GRID_MM = 2.54;

/** Default line width for symbol graphics (layer 94). */
export const SYMBOL_WIRE_WIDTH_MM = 0.254;

/** Round to a fixed number of decimals and normalise -0 to 0. */
export function round(n: number, digits = 4): number {
  const f = 10 ** digits;
  const r = Math.round(n * f) / f;
  return Object.is(r, -0) ? 0 : r;
}

export function pxToMm(px: number): number {
  return round(px * MM_PER_PX);
}

/** Eagle layer numbers used by the emitter. */
export const EAGLE = {
  TOP: 1,
  BOTTOM: 16,
  DIMENSION: 20,
  TPLACE: 21,
  BPLACE: 22,
  TNAMES: 25,
  BNAMES: 26,
  TVALUES: 27,
  BVALUES: 28,
  TKEEPOUT: 39,
  MILLING: 46,
  DOCUMENT: 48,
  TDOCU: 51,
  BDOCU: 52,
  SYMBOLS: 94,
  NAMES: 95,
  VALUES: 96,
} as const;

/** EasyEDA footprint layer ids as observed in the fixtures' `layers` tables. */
export const EASYEDA_LAYER_NAMES: Record<number, string> = {
  1: 'TopLayer',
  2: 'BottomLayer',
  3: 'TopSilkLayer',
  4: 'BottomSilkLayer',
  5: 'TopPasteMaskLayer',
  6: 'BottomPasteMaskLayer',
  7: 'TopSolderMaskLayer',
  8: 'BottomSolderMaskLayer',
  9: 'Ratlines',
  10: 'BoardOutLine',
  11: 'Multi-Layer',
  12: 'Document',
  13: 'TopAssembly',
  14: 'BottomAssembly',
  15: 'Mechanical',
  19: '3DModel',
  99: 'ComponentShapeLayer',
  100: 'LeadShapeLayer',
  101: 'ComponentPolarityLayer',
};

/** EasyEDA footprint layer → Eagle layer for non-pad graphics. */
export const FOOTPRINT_LAYER_MAP: Record<number, number> = {
  1: EAGLE.TOP,
  2: EAGLE.BOTTOM,
  3: EAGLE.TPLACE,
  4: EAGLE.BPLACE,
  10: EAGLE.DIMENSION,
  12: EAGLE.TDOCU,
  13: EAGLE.TDOCU,
  14: EAGLE.BDOCU,
  15: EAGLE.TDOCU,
  99: EAGLE.TDOCU,
  100: EAGLE.TDOCU,
  101: EAGLE.TDOCU,
};

/** Paste/mask layers are derived from pads by Eagle; graphics on them are dropped silently. */
export const DROPPED_FOOTPRINT_LAYERS = new Set([5, 6, 7, 8]);

/** EasyEDA multi-layer (through-hole) pad layer id. */
export const EASYEDA_MULTILAYER = 11;
