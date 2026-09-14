/** Convert a part model into the three Eagle library fragments. */

import type { Category } from '../categories.ts';
import type { PartModel } from '../easyeda/types.ts';
import { WarningCollector, type ConversionWarning } from '../warnings.ts';
import { emitDeviceset, gateName, type DevicesetSpec } from './deviceset.ts';
import { sanitiseName } from './names.ts';
import { emitPackage } from './package.ts';
import { emitSymbol } from './symbol.ts';
import { serialize, serializeAll, type XmlEl } from './xml.ts';

export interface ConvertedPart {
  lcsc: string;
  packageName: string;
  symbolNames: string[];
  devicesetName: string;
  packageEl: XmlEl;
  symbolEls: XmlEl[];
  devicesetEl: XmlEl;
  /** Parser warnings followed by emitter warnings. */
  warnings: ConversionWarning[];
  /** True when any warning has severity `error`: the part must not be merged. */
  hasErrors: boolean;
}

export function packageNameFor(model: PartModel): string {
  return sanitiseName(model.footprint.title || model.info.packageName);
}

export function devicesetNameFor(model: PartModel, category: Category): string {
  return sanitiseName(`${category.devicesetPrefix}_${model.info.title}`);
}

export function convertPart(model: PartModel, category: Category): ConvertedPart {
  const warnings = new WarningCollector();
  const packageName = packageNameFor(model);
  const devicesetName = devicesetNameFor(model, category);
  const pkg = emitPackage(model.footprint, packageName, warnings);

  const multi = model.units.length > 1;
  const symbolEls: XmlEl[] = [];
  const symbolNames: string[] = [];
  const gates: DevicesetSpec['gates'] = [];
  model.units.forEach((unit, i) => {
    const gname = gateName(i, model.units.length);
    const symbolName = multi ? sanitiseName(`${devicesetName}_${gname}`) : devicesetName;
    const sym = emitSymbol(unit, symbolName, warnings);
    symbolEls.push(sym.element);
    symbolNames.push(symbolName);
    gates.push({ name: gname, symbolName, pins: unit.pins.map((p, k) => ({ name: sym.pinNames[k], number: p.number })) });
  });

  const spec: DevicesetSpec = {
    name: devicesetName,
    packageName,
    pads: model.footprint.pads.map((p, i) => ({ name: pkg.padNames[i], number: p.number })),
    gates,
    category,
  };
  const devicesetEl = emitDeviceset(model, spec, warnings);
  const all = [...model.warnings, ...warnings.items];
  return {
    lcsc: model.info.lcsc,
    packageName,
    symbolNames,
    devicesetName,
    packageEl: pkg.element,
    symbolEls,
    devicesetEl,
    warnings: all,
    hasErrors: all.some((w) => w.severity === 'error'),
  };
}

/** All three fragments as text, for golden tests and debugging. */
export function fragmentsToString(c: ConvertedPart): string {
  return serialize(c.packageEl) + serializeAll(c.symbolEls) + serialize(c.devicesetEl);
}
