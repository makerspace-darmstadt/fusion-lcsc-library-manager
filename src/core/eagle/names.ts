/** Eagle library element names: uppercase, `[^A-Z0-9_.-]` → `_`, max 64 chars. */
export function sanitiseName(raw: string, max = 64): string {
  const s = raw
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9_.-]/g, '_')
    .replace(/^_+|_+$/g, '');
  return (s || 'UNNAMED').slice(0, max);
}

/** Pin names: whitespace → `_`; otherwise kept (Eagle accepts most characters). */
export function sanitisePinName(raw: string): string {
  const s = raw.trim().replace(/\s+/g, '_');
  return s || 'P';
}

/** Make names unique within a symbol using Eagle's `NAME@2`, `NAME@3` convention. */
export function dedupeNames(names: string[], sep = '@'): string[] {
  const seen = new Map<string, number>();
  const out: string[] = [];
  const taken = new Set<string>();
  for (const n of names) {
    const count = (seen.get(n) ?? 0) + 1;
    seen.set(n, count);
    let candidate = count === 1 ? n : `${n}${sep}${count}`;
    let k = count;
    while (taken.has(candidate)) candidate = `${n}${sep}${++k}`;
    taken.add(candidate);
    out.push(candidate);
  }
  return out;
}
