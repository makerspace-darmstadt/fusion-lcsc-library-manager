/**
 * Load / create / serialise Eagle `.lbr` documents with @xmldom/xmldom.
 *
 * Everything outside `<library>` is left untouched. Fusion writes one element per line without
 * indentation; new content is inserted with the same newline text nodes so the file stays uniform.
 */

import { DOMParser, XMLSerializer, type Document, type Element, type Node } from '@xmldom/xmldom';
import type { XmlEl } from '../eagle/xml.ts';
import { fmt } from '../eagle/xml.ts';

export const LIBRARY_CONTAINERS = ['packages', 'symbols', 'devicesets'] as const;
export type LibraryContainer = (typeof LIBRARY_CONTAINERS)[number];

export class LbrError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LbrError';
  }
}

export function parseLbr(text: string): Document {
  let fatal: string | null = null;
  const parser = new DOMParser({
    onError: (level, message) => {
      if (level === 'fatalError' && !fatal) fatal = String(message);
    },
  });
  let doc: Document;
  try {
    doc = parser.parseFromString(text, 'application/xml');
  } catch (e) {
    throw new LbrError(`Not a well-formed XML file: ${(e as Error).message.split('\n')[0]}`);
  }
  if (fatal) throw new LbrError(`Not a well-formed XML file: ${fatal}`);
  const root = doc.documentElement;
  if (!root || root.tagName !== 'eagle') throw new LbrError('Not an Eagle file (root element is not <eagle>)');
  if (!firstChildElement(root, 'drawing')) throw new LbrError('Not an Eagle library (<drawing> missing)');
  return doc;
}

export function serializeLbr(doc: Document): string {
  const s = new XMLSerializer().serializeToString(doc);
  return s.endsWith('\n') ? s : s + '\n';
}

export function firstChildElement(parent: Node, tagName: string): Element | null {
  for (let n = parent.firstChild; n; n = n.nextSibling) {
    if (n.nodeType === 1 && (n as Element).tagName === tagName) return n as Element;
  }
  return null;
}

export function childElements(parent: Node, tagName?: string): Element[] {
  const out: Element[] = [];
  for (let n = parent.firstChild; n; n = n.nextSibling) {
    if (n.nodeType === 1 && (!tagName || (n as Element).tagName === tagName)) out.push(n as Element);
  }
  return out;
}

/** `<library>` element of the document (created if missing, right after `<layers>`). */
export function libraryElement(doc: Document, create = false): Element {
  const drawing = firstChildElement(doc.documentElement!, 'drawing');
  if (!drawing) throw new LbrError('<drawing> missing');
  let lib = firstChildElement(drawing, 'library');
  if (!lib) {
    if (!create) throw new LbrError('Not an Eagle library (<library> missing)');
    lib = doc.createElement('library');
    lib.appendChild(doc.createTextNode('\n'));
    const layers = firstChildElement(drawing, 'layers');
    insertAfter(drawing, lib, layers);
  }
  return lib;
}

/** The `<packages>` / `<symbols>` / `<devicesets>` container; created in canonical order when absent. */
export function containerElement(doc: Document, name: LibraryContainer, create = false): Element | null {
  const lib = libraryElement(doc, create);
  const existing = firstChildElement(lib, name);
  if (existing || !create) return existing;
  const c = doc.createElement(name);
  c.appendChild(doc.createTextNode('\n'));
  // Insert after the previous container in canonical order (or after <description>), else at the end.
  const idx = LIBRARY_CONTAINERS.indexOf(name);
  let anchor: Element | null = null;
  for (let i = idx - 1; i >= 0 && !anchor; i--) anchor = firstChildElement(lib, LIBRARY_CONTAINERS[i]);
  if (!anchor) anchor = firstChildElement(lib, 'description');
  if (anchor) insertAfter(lib, c, anchor);
  else {
    // Before any later container if present, else append.
    let before: Element | null = null;
    for (let i = idx + 1; i < LIBRARY_CONTAINERS.length && !before; i++) before = firstChildElement(lib, LIBRARY_CONTAINERS[i]);
    if (before) {
      lib.insertBefore(c, before);
      lib.insertBefore(doc.createTextNode('\n'), before);
    } else appendWithNewline(lib, c);
  }
  return c;
}

function insertAfter(parent: Node, node: Node, ref: Node | null): void {
  const doc = parent.ownerDocument!;
  if (!ref) {
    appendWithNewline(parent, node);
    return;
  }
  // ref, "\n", node — keep the one-element-per-line layout
  let next = ref.nextSibling;
  if (next && next.nodeType === 3 && /^\s*$/.test(next.nodeValue ?? '')) next = next.nextSibling;
  else {
    parent.insertBefore(doc.createTextNode('\n'), next);
  }
  if (next) {
    parent.insertBefore(node, next);
    parent.insertBefore(doc.createTextNode('\n'), next);
  } else {
    parent.appendChild(node);
    parent.appendChild(doc.createTextNode('\n'));
  }
}

/** Append `node` so that it sits on its own line before the parent's closing tag. */
export function appendWithNewline(parent: Node, node: Node): void {
  const doc = parent.ownerDocument!;
  const last = parent.lastChild;
  if (!(last && last.nodeType === 3 && /\n\s*$/.test(last.nodeValue ?? ''))) parent.appendChild(doc.createTextNode('\n'));
  parent.appendChild(node);
  parent.appendChild(doc.createTextNode('\n'));
}

/** Convert an emitter element tree to DOM nodes with Fusion-style newlines. */
export function toDom(doc: Document, e: XmlEl): Element {
  const node = doc.createElement(e.name);
  for (const [k, v] of Object.entries(e.attrs)) node.setAttribute(k, typeof v === 'number' ? fmt(v) : v);
  if (e.children.length === 0) return node;
  if (e.children.every((c) => typeof c === 'string')) {
    node.appendChild(doc.createTextNode(e.children.join('')));
    return node;
  }
  node.appendChild(doc.createTextNode('\n'));
  for (const c of e.children) {
    node.appendChild(typeof c === 'string' ? doc.createTextNode(c) : toDom(doc, c));
    node.appendChild(doc.createTextNode('\n'));
  }
  return node;
}

/**
 * Create a fresh library document from the reference file: keep `<settings>`, `<grid>` and `<layers>`,
 * replace the library content with empty containers.
 */
export function createEmptyLibrary(referenceText: string, description = 'LCSC parts imported with lcsc-lbr-manager'): Document {
  const doc = parseLbr(referenceText);
  const drawing = firstChildElement(doc.documentElement!, 'drawing')!;
  const oldLib = firstChildElement(drawing, 'library');
  const lib = doc.createElement('library');
  lib.appendChild(doc.createTextNode('\n'));
  const desc = doc.createElement('description');
  desc.appendChild(doc.createTextNode(description));
  lib.appendChild(desc);
  lib.appendChild(doc.createTextNode('\n'));
  for (const name of LIBRARY_CONTAINERS) {
    const c = doc.createElement(name);
    c.appendChild(doc.createTextNode('\n'));
    lib.appendChild(c);
    lib.appendChild(doc.createTextNode('\n'));
  }
  if (oldLib) drawing.replaceChild(lib, oldLib);
  else insertAfter(drawing, lib, firstChildElement(drawing, 'layers'));
  return doc;
}

export interface LibraryEntry {
  name: string;
  element: Element;
}

export function listEntries(doc: Document, container: LibraryContainer): LibraryEntry[] {
  const c = containerElement(doc, container);
  if (!c) return [];
  const tag = container.slice(0, -1); // packages → package
  return childElements(c, tag).map((e) => ({ name: e.getAttribute('name') ?? '', element: e }));
}

export function findEntry(doc: Document, container: LibraryContainer, name: string): Element | null {
  return listEntries(doc, container).find((e) => e.name === name)?.element ?? null;
}

/** Append an emitted element to a container (creating the container when needed). */
export function appendEntry(doc: Document, container: LibraryContainer, e: XmlEl): Element {
  const c = containerElement(doc, container, true)!;
  const node = toDom(doc, e);
  appendWithNewline(c, node);
  return node;
}

export interface DevicesetSummary {
  name: string;
  prefix: string;
  description: string;
  packages: string[];
  lcsc: string[];
}

/** Summary of every deviceset (name, package(s), LCSC attribute(s)) for the UI table. */
export function summariseDevicesets(doc: Document): DevicesetSummary[] {
  return listEntries(doc, 'devicesets').map(({ name, element }) => {
    const packages: string[] = [];
    const lcsc: string[] = [];
    const devices = firstChildElement(element, 'devices');
    for (const dev of devices ? childElements(devices, 'device') : []) {
      const pkg = dev.getAttribute('package');
      if (pkg && !packages.includes(pkg)) packages.push(pkg);
      const techs = firstChildElement(dev, 'technologies');
      for (const tech of techs ? childElements(techs, 'technology') : []) {
        for (const attr of childElements(tech, 'attribute')) {
          if ((attr.getAttribute('name') ?? '').toUpperCase() === 'LCSC') {
            const v = attr.getAttribute('value') ?? '';
            if (v && !lcsc.includes(v)) lcsc.push(v);
          }
        }
      }
    }
    const desc = firstChildElement(element, 'description');
    return { name, prefix: element.getAttribute('prefix') ?? '', description: desc?.textContent ?? '', packages, lcsc };
  });
}
