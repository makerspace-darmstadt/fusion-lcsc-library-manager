/**
 * Remove a deviceset from a library, optionally together with the packages and symbols that no other
 * deviceset (or `<packages3d>` entry) references any more. Everything else is left untouched.
 */

import type { Document, Element, Node } from '@xmldom/xmldom';
import { childElements, findEntry, firstChildElement, libraryElement, listEntries } from './document.ts';
import { LbrError } from './document.ts';

export interface RemovalPlan {
  devicesetName: string;
  /** Packages used only by this deviceset. */
  orphanPackages: string[];
  /** Symbols used only by this deviceset. */
  orphanSymbols: string[];
}

export interface RemovalOptions {
  /** Also remove the orphaned packages/symbols (default true). */
  removeOrphans?: boolean;
}

export interface RemovalResult {
  removedDeviceset: string;
  removedPackages: string[];
  removedSymbols: string[];
}

function devicesetPackages(ds: Element): Set<string> {
  const out = new Set<string>();
  const devices = firstChildElement(ds, 'devices');
  for (const d of devices ? childElements(devices, 'device') : []) {
    const p = d.getAttribute('package');
    if (p) out.add(p);
  }
  return out;
}

function devicesetSymbols(ds: Element): Set<string> {
  const out = new Set<string>();
  const gates = firstChildElement(ds, 'gates');
  for (const g of gates ? childElements(gates, 'gate') : []) {
    const s = g.getAttribute('symbol');
    if (s) out.add(s);
  }
  return out;
}

/** Packages referenced from `<packages3d>` (Fusion 3D package instances) must never be removed. */
function packages3dReferences(doc: Document): Set<string> {
  const out = new Set<string>();
  const lib = libraryElement(doc);
  const p3d = firstChildElement(lib, 'packages3d');
  if (!p3d) return out;
  const all = p3d.getElementsByTagName('packageinstance');
  for (let i = 0; i < all.length; i++) {
    const n = all.item(i)?.getAttribute('name');
    if (n) out.add(n);
  }
  return out;
}

export function planRemoval(doc: Document, devicesetName: string): RemovalPlan {
  const target = findEntry(doc, 'devicesets', devicesetName);
  if (!target) throw new LbrError(`Deviceset "${devicesetName}" not found`);
  const myPackages = devicesetPackages(target);
  const mySymbols = devicesetSymbols(target);
  const usedElsewhere = { packages: packages3dReferences(doc), symbols: new Set<string>() };
  for (const { name, element } of listEntries(doc, 'devicesets')) {
    if (name === devicesetName) continue;
    for (const p of devicesetPackages(element)) usedElsewhere.packages.add(p);
    for (const s of devicesetSymbols(element)) usedElsewhere.symbols.add(s);
  }
  const existing = (c: 'packages' | 'symbols', n: string) => findEntry(doc, c, n) !== null;
  return {
    devicesetName,
    orphanPackages: [...myPackages].filter((p) => !usedElsewhere.packages.has(p) && existing('packages', p)),
    orphanSymbols: [...mySymbols].filter((s) => !usedElsewhere.symbols.has(s) && existing('symbols', s)),
  };
}

/** Remove an element and the newline text node that keeps the one-element-per-line layout. */
function removeWithNewline(node: Node): void {
  const parent = node.parentNode;
  if (!parent) return;
  const isBlank = (n: Node | null): n is Node => !!n && n.nodeType === 3 && /^\s*$/.test(n.nodeValue ?? '');
  const next = node.nextSibling;
  const prev = node.previousSibling;
  parent.removeChild(node);
  if (isBlank(next)) parent.removeChild(next);
  else if (isBlank(prev)) parent.removeChild(prev);
}

export function applyRemoval(doc: Document, devicesetName: string, options: RemovalOptions = {}): RemovalResult {
  const plan = planRemoval(doc, devicesetName);
  const removeOrphans = options.removeOrphans ?? true;
  const result: RemovalResult = { removedDeviceset: devicesetName, removedPackages: [], removedSymbols: [] };
  removeWithNewline(findEntry(doc, 'devicesets', devicesetName)!);
  if (removeOrphans) {
    for (const p of plan.orphanPackages) {
      const e = findEntry(doc, 'packages', p);
      if (e) {
        removeWithNewline(e);
        result.removedPackages.push(p);
      }
    }
    for (const s of plan.orphanSymbols) {
      const e = findEntry(doc, 'symbols', s);
      if (e) {
        removeWithNewline(e);
        result.removedSymbols.push(s);
      }
    }
  }
  // Containers are kept even when empty (Fusion writes empty containers too).
  return result;
}
