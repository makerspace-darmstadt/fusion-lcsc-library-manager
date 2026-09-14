/**
 * Tiny XML element tree used by the emitters. Serialised in Fusion's own style: one element per line,
 * no indentation, text-only elements on a single line.
 */

export type AttrValue = string | number;

export interface XmlEl {
  name: string;
  attrs: Record<string, AttrValue>;
  children: (XmlEl | string)[];
}

export function el(name: string, attrs: Record<string, AttrValue | undefined> = {}, children: (XmlEl | string)[] = []): XmlEl {
  const clean: Record<string, AttrValue> = {};
  for (const [k, v] of Object.entries(attrs)) if (v !== undefined) clean[k] = v;
  return { name, attrs: clean, children };
}

export function escapeText(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export function escapeAttr(s: string): string {
  return escapeText(s).replace(/"/g, '&quot;');
}

/** Format a number the way Eagle writes it: no exponent, no trailing zeros, `-0` → `0`. */
export function fmt(n: number): string {
  if (Object.is(n, -0) || n === 0) return '0';
  const s = Number(n.toFixed(6)).toString();
  return s.includes('e') ? n.toFixed(6).replace(/\.?0+$/, '') : s;
}

function attrsToString(attrs: Record<string, AttrValue>): string {
  let s = '';
  for (const [k, v] of Object.entries(attrs)) s += ` ${k}="${typeof v === 'number' ? fmt(v) : escapeAttr(v)}"`;
  return s;
}

export function serialize(e: XmlEl): string {
  const open = `<${e.name}${attrsToString(e.attrs)}`;
  if (e.children.length === 0) return `${open}/>\n`;
  if (e.children.every((c) => typeof c === 'string')) return `${open}>${escapeText(e.children.join(''))}</${e.name}>\n`;
  let s = `${open}>\n`;
  for (const c of e.children) s += typeof c === 'string' ? escapeText(c) + '\n' : serialize(c);
  return `${s}</${e.name}>\n`;
}

export function serializeAll(els: XmlEl[]): string {
  return els.map(serialize).join('');
}
