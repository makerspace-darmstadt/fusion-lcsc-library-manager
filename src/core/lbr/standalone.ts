/** Build a brand-new `.lbr` (skeleton from the reference file) containing one or more converted parts. */

import type { ConvertedPart } from '../eagle/convert.ts';
import { appendEntry, createEmptyLibrary, serializeLbr } from './document.ts';

export function buildStandaloneLbr(referenceText: string, parts: ConvertedPart[]): string {
  const doc = createEmptyLibrary(referenceText);
  const packages = new Set<string>();
  const symbols = new Set<string>();
  for (const p of parts) {
    if (!packages.has(p.packageName)) {
      appendEntry(doc, 'packages', p.packageEl);
      packages.add(p.packageName);
    }
    p.symbolEls.forEach((s, i) => {
      if (!symbols.has(p.symbolNames[i])) {
        appendEntry(doc, 'symbols', s);
        symbols.add(p.symbolNames[i]);
      }
    });
    appendEntry(doc, 'devicesets', p.devicesetEl);
  }
  return serializeLbr(doc);
}
