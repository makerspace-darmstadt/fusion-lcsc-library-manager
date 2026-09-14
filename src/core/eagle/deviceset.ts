/** Emit an Eagle `<deviceset>` (gates, device, connects, attributes) for a converted part. */

import type { Category } from '../categories.ts';
import { isPassiveCategory } from '../categories.ts';
import type { PartModel } from '../easyeda/types.ts';
import type { WarningCollector } from '../warnings.ts';
import { el, type XmlEl } from './xml.ts';

export interface GateSpec {
  name: string;
  symbolName: string;
  /** Pin names (final) and EasyEDA pin numbers, in symbol order. */
  pins: { name: string; number: string }[];
}

export interface DevicesetSpec {
  name: string;
  packageName: string;
  /** Final pad names paired with their EasyEDA pad numbers. */
  pads: { name: string; number: string }[];
  gates: GateSpec[];
  category: Category;
}

export function gateName(index: number, total: number): string {
  if (total <= 1) return 'G$1';
  return String.fromCharCode('A'.charCodeAt(0) + index);
}

export function buildDescription(model: PartModel, category: Category): string {
  const { info } = model;
  const parts: string[] = [info.description?.trim() || info.title];
  parts.push(`LCSC ${info.lcsc}`);
  const mfr = [info.manufacturer, info.mpn].filter(Boolean).join(' ');
  if (mfr) parts.push(mfr);
  let s = parts.join(' — ');
  const keywords = [category.keywords, ...info.tags.map((t) => t.toLowerCase())].filter(Boolean);
  if (keywords.length) s += `. Keywords: ${keywords.join(', ')}`;
  if (info.productUrl) s += `\n<a href="${info.productUrl}">LCSC product page</a>`;
  return s;
}

export function emitDeviceset(model: PartModel, spec: DevicesetSpec, warnings: WarningCollector): XmlEl {
  const { info } = model;
  const padsByNumber = new Map<string, string[]>();
  for (const p of spec.pads) {
    const list = padsByNumber.get(p.number) ?? [];
    list.push(p.name);
    padsByNumber.set(p.number, list);
  }
  const usedPads = new Set<string>();
  const connects: XmlEl[] = [];
  const seenPinNumbers = new Set<string>();
  spec.gates.forEach((gate, gi) => {
    for (const pin of gate.pins) {
      if (seenPinNumbers.has(pin.number)) {
        warnings.warn('DUPLICATE_PIN_NUMBER', `Pin number ${pin.number} (${gate.name}.${pin.name}) is used by more than one pin; only the first one is connected`);
        continue;
      }
      seenPinNumbers.add(pin.number);
      const pads = padsByNumber.get(pin.number);
      if (!pads || pads.length === 0) {
        warnings.error('PIN_WITHOUT_PAD', `Pin ${pin.number} (${gate.name}.${pin.name}) has no matching pad in package ${spec.packageName}`);
        continue;
      }
      pads.forEach((p) => usedPads.add(p));
      connects.push(el('connect', { gate: gate.name, pin: pin.name, pad: pads.join(' ') }));
    }
    void gi;
  });
  for (const p of spec.pads) {
    if (!usedPads.has(p.name)) warnings.warn('UNCONNECTED_PAD', `Pad ${p.name} is not connected to any symbol pin`);
  }

  const attributes: XmlEl[] = [el('attribute', { name: 'LCSC', value: info.lcsc, constant: 'no' })];
  if (info.manufacturer) attributes.push(el('attribute', { name: 'MANUFACTURER', value: info.manufacturer, constant: 'no' }));
  if (info.mpn) attributes.push(el('attribute', { name: 'MPN', value: info.mpn, constant: 'no' }));

  const gates = spec.gates.map((g, i) => el('gate', { name: g.name, symbol: g.symbolName, x: i * 25.4, y: 0 }));
  return el(
    'deviceset',
    { name: spec.name, prefix: spec.category.designator, uservalue: isPassiveCategory(spec.category) ? 'yes' : undefined },
    [
      el('description', {}, [buildDescription(model, spec.category)]),
      el('gates', {}, gates),
      el('devices', {}, [
        el('device', { name: '', package: spec.packageName }, [
          el('connects', {}, connects),
          el('technologies', {}, [el('technology', { name: '' }, attributes)]),
        ]),
      ]),
    ],
  );
}
