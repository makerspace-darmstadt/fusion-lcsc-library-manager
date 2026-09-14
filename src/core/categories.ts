/**
 * Categories are emulated on top of the lbr format: they decide the deviceset name prefix, the
 * designator prefix and a keyword line in the description.
 */

import type { PartInfo } from './easyeda/types.ts';

export interface Category {
  /** Stable id used in settings. */
  id: string;
  /** Display name. */
  name: string;
  /** Deviceset name prefix, e.g. `CAP`. */
  devicesetPrefix: string;
  /** Eagle designator prefix, e.g. `C`. */
  designator: string;
  /** Keyword line appended to the deviceset description. */
  keywords: string;
}

export const DEFAULT_CATEGORIES: Category[] = [
  { id: 'capacitor', name: 'Capacitor', devicesetPrefix: 'CAP', designator: 'C', keywords: 'capacitor, ceramic, mlcc' },
  { id: 'resistor', name: 'Resistor', devicesetPrefix: 'RES', designator: 'R', keywords: 'resistor' },
  { id: 'inductor', name: 'Inductor', devicesetPrefix: 'IND', designator: 'L', keywords: 'inductor, coil, ferrite' },
  { id: 'diode', name: 'Diode', devicesetPrefix: 'DIO', designator: 'D', keywords: 'diode, rectifier, schottky, zener, tvs' },
  { id: 'transistor', name: 'Transistor', devicesetPrefix: 'TRA', designator: 'Q', keywords: 'transistor, mosfet, bjt' },
  { id: 'ic', name: 'IC', devicesetPrefix: 'IC', designator: 'U', keywords: 'ic, integrated circuit' },
  { id: 'connector', name: 'Connector', devicesetPrefix: 'CON', designator: 'J', keywords: 'connector, header, socket' },
  { id: 'switch', name: 'Switch', devicesetPrefix: 'SW', designator: 'S', keywords: 'switch, button' },
  { id: 'crystal', name: 'Crystal', devicesetPrefix: 'XTAL', designator: 'Y', keywords: 'crystal, oscillator, resonator' },
  { id: 'led', name: 'LED', devicesetPrefix: 'LED', designator: 'D', keywords: 'led, light emitting diode' },
  { id: 'misc', name: 'Misc', devicesetPrefix: 'MISC', designator: 'X', keywords: 'misc' },
];

const PREFIX_TO_ID: Record<string, string> = {
  C: 'capacitor',
  R: 'resistor',
  L: 'inductor',
  D: 'diode',
  Q: 'transistor',
  U: 'ic',
  J: 'connector',
  P: 'connector',
  CN: 'connector',
  S: 'switch',
  SW: 'switch',
  Y: 'crystal',
  X: 'crystal',
  LED: 'led',
};

/** Auto-suggest a category from the EasyEDA designator prefix, tags and title. */
export function suggestCategory(info: Pick<PartInfo, 'prefix' | 'tags' | 'title' | 'description'>, categories: Category[] = DEFAULT_CATEGORIES): Category {
  const byId = (id: string): Category | undefined => categories.find((c) => c.id === id);
  const haystack = `${info.tags.join(' ')} ${info.title} ${info.description}`.toLowerCase();
  const textHints: [RegExp, string][] = [
    [/\bled\b|light emitting/, 'led'],
    [/crystal|oscillator|resonator/, 'crystal'],
    [/connector|header|socket|usb|rj45|terminal block/, 'connector'],
    [/\bswitch|tactile|button/, 'switch'],
    [/inductor|ferrite bead/, 'inductor'],
  ];
  const prefix = info.prefix.toUpperCase();
  // Text hints win over ambiguous prefixes (D can be a diode or an LED; U can be a connector module).
  for (const [re, id] of textHints) {
    if (re.test(haystack)) {
      const c = byId(id);
      if (c) return c;
    }
  }
  const fromPrefix = byId(PREFIX_TO_ID[prefix] ?? '');
  if (fromPrefix) return fromPrefix;
  return byId('misc') ?? categories[0];
}

/** Passives get `uservalue="yes"` so the schematic value (100nF, 10k, …) is editable. */
export function isPassiveCategory(category: Category): boolean {
  return ['capacitor', 'resistor', 'inductor'].includes(category.id) || ['C', 'R', 'L'].includes(category.designator);
}
