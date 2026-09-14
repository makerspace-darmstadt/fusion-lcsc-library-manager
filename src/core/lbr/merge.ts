/**
 * Merge a converted part into an existing library document.
 *
 * Rules (brief §7):
 * - `<package>` / `<symbol>` with the same name: reuse when identical after normalisation, otherwise the
 *   caller decides per element: reuse the existing one or import under `<name>_2` (`_3`, …).
 * - A deviceset whose device already carries the same `LCSC` attribute → "already in library", skip.
 * - Nothing outside `<library>` is touched; containers are only appended to (created when absent).
 */

import type { Document, Element, Node } from '@xmldom/xmldom';
import type { ConvertedPart } from '../eagle/convert.ts';
import type { XmlEl } from '../eagle/xml.ts';
import { appendEntry, childElements, findEntry, listEntries, summariseDevicesets, toDom, type LibraryContainer } from './document.ts';

export type CollisionKind = 'package' | 'symbol';
export type CollisionStatus = 'new' | 'identical' | 'conflict';
export type Resolution = 'reuse' | 'rename';

export interface ElementPlan {
  kind: CollisionKind;
  name: string;
  status: CollisionStatus;
}

export interface MergePlan {
  /** Name of the deviceset that already carries this LCSC number, if any. */
  alreadyPresentAs: string | null;
  packages: ElementPlan[];
  symbols: ElementPlan[];
  devicesetName: string;
  /** Set when a deviceset with the same name (but a different LCSC) exists. */
  devicesetRenamedTo: string | null;
  /** Elements whose status is `conflict` and therefore need a Resolution. */
  conflicts: ElementPlan[];
}

export interface MergeOptions {
  /** Resolution per conflict, keyed `${kind}:${name}`. */
  resolutions?: Record<string, Resolution>;
}

export interface MergeResult {
  skipped: boolean;
  alreadyPresentAs: string | null;
  addedPackages: string[];
  addedSymbols: string[];
  reused: string[];
  /** original name → imported name */
  renamed: Record<string, string>;
  devicesetName: string | null;
}

export class MergeConflictError extends Error {
  readonly conflicts: ElementPlan[];

  constructor(conflicts: ElementPlan[]) {
    super(`Unresolved collisions: ${conflicts.map((c) => `${c.kind} ${c.name}`).join(', ')}`);
    this.name = 'MergeConflictError';
    this.conflicts = conflicts;
  }
}

// ---------------------------------------------------------------------------------------------
// Canonical form for "identical after normalisation" comparisons
// ---------------------------------------------------------------------------------------------

const NUMERIC = /^-?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?$/;

function normaliseValue(v: string): string {
  const t = v.trim();
  if (NUMERIC.test(t)) {
    const n = Number(t);
    return Number.isFinite(n) ? String(Math.round(n * 1e6) / 1e6 + 0) : t;
  }
  return t;
}

/**
 * Canonical string of an element: sorted attributes with normalised numbers, whitespace-collapsed text,
 * children in document order. Ignores comments and attribute quoting.
 */
export function canonicalize(node: Element): string {
  const attrs: string[] = [];
  for (let i = 0; i < node.attributes.length; i++) {
    const a = node.attributes.item(i)!;
    attrs.push(`${a.name}=${JSON.stringify(normaliseValue(a.value))}`);
  }
  attrs.sort();
  let inner = '';
  let text = '';
  for (let n: Node | null = node.firstChild; n; n = n.nextSibling) {
    if (n.nodeType === 1) {
      if (text.trim()) inner += `#${JSON.stringify(text.trim().replace(/\s+/g, ' '))}`;
      text = '';
      inner += canonicalize(n as Element);
    } else if (n.nodeType === 3 || n.nodeType === 4) {
      text += n.nodeValue ?? '';
    }
  }
  if (text.trim()) inner += `#${JSON.stringify(text.trim().replace(/\s+/g, ' '))}`;
  return `<${node.tagName}${attrs.length ? ' ' + attrs.join(' ') : ''}>${inner}</${node.tagName}>`;
}

/** Semantic equality of two whole documents (used by the round-trip test). */
export function canonicalizeDocument(doc: Document): string {
  return canonicalize(doc.documentElement!);
}

// ---------------------------------------------------------------------------------------------
// Planning
// ---------------------------------------------------------------------------------------------

function planElement(doc: Document, container: LibraryContainer, kind: CollisionKind, e: XmlEl): ElementPlan {
  const name = String(e.attrs.name);
  const existing = findEntry(doc, container, name);
  if (!existing) return { kind, name, status: 'new' };
  const identical = canonicalize(existing) === canonicalize(toDom(doc, e));
  return { kind, name, status: identical ? 'identical' : 'conflict' };
}

export function findDevicesetByLcsc(doc: Document, lcsc: string): string | null {
  const wanted = lcsc.toUpperCase();
  for (const d of summariseDevicesets(doc)) if (d.lcsc.some((v) => v.toUpperCase() === wanted)) return d.name;
  return null;
}

export function freeName(doc: Document, container: LibraryContainer, base: string, reserved: Set<string> = new Set()): string {
  const taken = new Set(listEntries(doc, container).map((e) => e.name));
  for (const r of reserved) taken.add(r);
  if (!taken.has(base)) return base;
  for (let i = 2; ; i++) {
    const candidate = `${base}_${i}`;
    if (!taken.has(candidate)) return candidate;
  }
}

export function planMerge(doc: Document, part: ConvertedPart): MergePlan {
  const alreadyPresentAs = findDevicesetByLcsc(doc, part.lcsc);
  const packages = [planElement(doc, 'packages', 'package', part.packageEl)];
  const symbols = part.symbolEls.map((s) => planElement(doc, 'symbols', 'symbol', s));
  const devicesetExists = findEntry(doc, 'devicesets', part.devicesetName) !== null;
  return {
    alreadyPresentAs,
    packages,
    symbols,
    devicesetName: part.devicesetName,
    devicesetRenamedTo: devicesetExists && !alreadyPresentAs ? freeName(doc, 'devicesets', part.devicesetName) : null,
    conflicts: [...packages, ...symbols].filter((p) => p.status === 'conflict'),
  };
}

// ---------------------------------------------------------------------------------------------
// Applying
// ---------------------------------------------------------------------------------------------

function cloneEl(e: XmlEl): XmlEl {
  return { name: e.name, attrs: { ...e.attrs }, children: e.children.map((c) => (typeof c === 'string' ? c : cloneEl(c))) };
}

/** Rewrite references inside the deviceset: gate/@symbol and device/@package. */
function retargetDeviceset(ds: XmlEl, symbolRenames: Record<string, string>, packageRenames: Record<string, string>): void {
  const walk = (e: XmlEl) => {
    if (e.name === 'gate' && typeof e.attrs.symbol === 'string' && symbolRenames[e.attrs.symbol]) e.attrs.symbol = symbolRenames[e.attrs.symbol];
    if (e.name === 'device' && typeof e.attrs.package === 'string' && packageRenames[e.attrs.package]) e.attrs.package = packageRenames[e.attrs.package];
    for (const c of e.children) if (typeof c !== 'string') walk(c);
  };
  walk(ds);
}

/**
 * Apply the merge. Throws MergeConflictError when a conflict has no resolution.
 * The document is modified in place; serialise it afterwards with `serializeLbr`.
 */
export function applyMerge(doc: Document, part: ConvertedPart, options: MergeOptions = {}): MergeResult {
  const plan = planMerge(doc, part);
  const result: MergeResult = {
    skipped: false,
    alreadyPresentAs: plan.alreadyPresentAs,
    addedPackages: [],
    addedSymbols: [],
    reused: [],
    renamed: {},
    devicesetName: null,
  };
  if (plan.alreadyPresentAs) {
    result.skipped = true;
    return result;
  }
  const resolutions = options.resolutions ?? {};
  const unresolved = plan.conflicts.filter((c) => !resolutions[`${c.kind}:${c.name}`]);
  if (unresolved.length) throw new MergeConflictError(unresolved);

  const packageRenames: Record<string, string> = {};
  const symbolRenames: Record<string, string> = {};

  const handle = (p: ElementPlan, container: LibraryContainer, e: XmlEl, renames: Record<string, string>, added: string[]) => {
    if (p.status === 'identical') {
      result.reused.push(`${p.kind} ${p.name}`);
      return;
    }
    if (p.status === 'conflict') {
      if (resolutions[`${p.kind}:${p.name}`] === 'reuse') {
        result.reused.push(`${p.kind} ${p.name}`);
        return;
      }
      const newName = freeName(doc, container, p.name, new Set(added));
      renames[p.name] = newName;
      result.renamed[p.name] = newName;
      const copy = cloneEl(e);
      copy.attrs.name = newName;
      appendEntry(doc, container, copy);
      added.push(newName);
      return;
    }
    appendEntry(doc, container, e);
    added.push(p.name);
  };

  handle(plan.packages[0], 'packages', part.packageEl, packageRenames, result.addedPackages);
  plan.symbols.forEach((p, i) => handle(p, 'symbols', part.symbolEls[i], symbolRenames, result.addedSymbols));

  const ds = cloneEl(part.devicesetEl);
  if (plan.devicesetRenamedTo) {
    ds.attrs.name = plan.devicesetRenamedTo;
    result.renamed[part.devicesetName] = plan.devicesetRenamedTo;
  }
  retargetDeviceset(ds, symbolRenames, packageRenames);
  appendEntry(doc, 'devicesets', ds);
  result.devicesetName = String(ds.attrs.name);
  return result;
}

/** Names of all child elements of a container, for tests and the UI. */
export function entryNames(doc: Document, container: LibraryContainer): string[] {
  return listEntries(doc, container).map((e) => e.name);
}

export { childElements };
