/** Emit an Eagle `<symbol>` from a symbol unit. */

import type { SymbolGraphic, SymbolPin, SymbolUnit } from '../easyeda/types.ts';
import { EAGLE, SYMBOL_WIRE_WIDTH_MM, round } from '../units.ts';
import type { WarningCollector } from '../warnings.ts';
import { dedupeNames, sanitisePinName } from './names.ts';
import { el, type XmlEl } from './xml.ts';

export const SYMBOL_TEXT_SIZE = 1.778;

export interface EmittedSymbol {
  element: XmlEl;
  /** Final unique pin names, in the order of `unit.pins`. */
  pinNames: string[];
}

const LENGTHS: [number, string][] = [
  [0, 'point'],
  [2.54, 'short'],
  [5.08, 'middle'],
  [7.62, 'long'],
];

export function pinLength(mm: number, pin: SymbolPin, warnings: WarningCollector): string {
  let best = LENGTHS[0];
  for (const l of LENGTHS) if (Math.abs(l[0] - mm) < Math.abs(best[0] - mm)) best = l;
  if (Math.abs(best[0] - mm) > 1e-3) {
    warnings.warn('PIN_LENGTH', `Pin ${pin.number} (${pin.name}): length ${mm} mm is not an Eagle pin length; using "${best[1]}" (${best[0]} mm)`, pin.raw);
  }
  return best[1];
}

const DIRECTIONS: Record<number, string> = { 0: 'pas', 1: 'in', 2: 'out', 3: 'io', 4: 'pwr' };

export function pinVisible(pin: SymbolPin): string {
  if (pin.nameVisible && pin.numberVisible) return 'both';
  if (pin.nameVisible) return 'pin';
  if (pin.numberVisible) return 'pad';
  return 'off';
}

function emitGraphic(g: SymbolGraphic, out: XmlEl[]): void {
  switch (g.kind) {
    case 'wire':
      out.push(el('wire', { x1: g.x1, y1: g.y1, x2: g.x2, y2: g.y2, width: SYMBOL_WIRE_WIDTH_MM, layer: EAGLE.SYMBOLS, curve: g.curve }));
      return;
    case 'circle':
      out.push(el('circle', { x: g.x, y: g.y, radius: g.radius, width: g.filled ? 0 : SYMBOL_WIRE_WIDTH_MM, layer: EAGLE.SYMBOLS }));
      return;
    case 'polygon':
      out.push(
        el(
          'polygon',
          { width: SYMBOL_WIRE_WIDTH_MM, layer: EAGLE.SYMBOLS },
          g.points.map((p) => el('vertex', { x: p.x, y: p.y, curve: p.curve })),
        ),
      );
      return;
    case 'text': {
      const align = g.anchor === 'middle' ? 'center' : g.anchor === 'end' ? 'center-right' : 'center-left';
      out.push(el('text', { x: g.x, y: g.y, size: g.size, layer: EAGLE.SYMBOLS, rot: g.rot === 0 ? undefined : `R${round(g.rot, 3)}`, align }, [g.text]));
    }
  }
}

function graphicsBBox(unit: SymbolUnit): { minX: number; minY: number; maxX: number; maxY: number } {
  const b = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
  const grow = (x: number, y: number) => {
    b.minX = Math.min(b.minX, x);
    b.minY = Math.min(b.minY, y);
    b.maxX = Math.max(b.maxX, x);
    b.maxY = Math.max(b.maxY, y);
  };
  for (const g of unit.graphics) {
    if (g.kind === 'wire') {
      grow(g.x1, g.y1);
      grow(g.x2, g.y2);
    } else if (g.kind === 'circle') {
      grow(g.x - g.radius, g.y - g.radius);
      grow(g.x + g.radius, g.y + g.radius);
    } else if (g.kind === 'polygon') {
      for (const p of g.points) grow(p.x, p.y);
    }
  }
  if (!Number.isFinite(b.minX)) {
    for (const p of unit.pins) grow(p.x, p.y);
  }
  if (!Number.isFinite(b.minX)) return { minX: -2.54, minY: -2.54, maxX: 2.54, maxY: 2.54 };
  return b;
}

export function emitSymbol(unit: SymbolUnit, name: string, warnings: WarningCollector): EmittedSymbol {
  const children: XmlEl[] = [];
  let nameText: XmlEl | null = null;
  let valueText: XmlEl | null = null;
  for (const g of unit.graphics) {
    if (g.kind === 'text' && (g.mark === 'P' || g.mark === 'N')) {
      nameText = el('text', { x: g.x, y: g.y, size: SYMBOL_TEXT_SIZE, layer: EAGLE.NAMES }, ['>NAME']);
    } else if (g.kind === 'text' && g.mark === 'V') {
      valueText = el('text', { x: g.x, y: g.y, size: SYMBOL_TEXT_SIZE, layer: EAGLE.VALUES }, ['>VALUE']);
    } else {
      emitGraphic(g, children);
    }
  }
  const b = graphicsBBox(unit);
  // Text origin is on the 1.27 mm half grid so it never lands on a pin
  const snap = (v: number) => round(Math.round(v / 1.27) * 1.27);
  if (!nameText) nameText = el('text', { x: snap(b.minX), y: snap(b.maxY + 1.27), size: SYMBOL_TEXT_SIZE, layer: EAGLE.NAMES }, ['>NAME']);
  if (!valueText) valueText = el('text', { x: snap(b.minX), y: snap(b.minY - 1.27), size: SYMBOL_TEXT_SIZE, layer: EAGLE.VALUES, align: 'top-left' }, ['>VALUE']);
  children.push(nameText, valueText);

  const pinNames = dedupeNames(unit.pins.map((p) => sanitisePinName(p.name)));
  unit.pins.forEach((p, i) => {
    if (pinNames[i] !== sanitisePinName(p.name)) {
      warnings.info('DUPLICATE_PIN_NAME', `Pin ${p.number}: name "${p.name}" occurs more than once; emitted as ${pinNames[i]} (Eagle joins NAME@n pins)`);
    }
    const fn = p.dot && p.clock ? 'dotclk' : p.dot ? 'dot' : p.clock ? 'clk' : undefined;
    children.push(
      el('pin', {
        name: pinNames[i],
        x: p.x,
        y: p.y,
        visible: pinVisible(p),
        length: pinLength(p.length, p, warnings),
        direction: DIRECTIONS[p.electric] ?? 'pas',
        function: fn,
        rot: p.rot === 0 ? undefined : `R${p.rot}`,
      }),
    );
  });
  return { element: el('symbol', { name }, children), pinNames };
}
