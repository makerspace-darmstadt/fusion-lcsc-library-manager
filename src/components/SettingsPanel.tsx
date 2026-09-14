import { useState } from 'react';
import { DEFAULT_CATEGORIES, type Category } from '../core/categories.ts';

interface Props {
  categories: Category[];
  onSave: (categories: Category[]) => void;
  onClose: () => void;
}

const slug = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '') || 'category';

export function SettingsPanel({ categories, onSave, onClose }: Props) {
  const [rows, setRows] = useState<Category[]>(categories.map((c) => ({ ...c })));
  const update = (i: number, patch: Partial<Category>) => setRows(rows.map((r, k) => (k === i ? { ...r, ...patch } : r)));
  const valid = rows.length > 0 && rows.every((r) => r.name.trim() && /^[A-Z0-9_]+$/.test(r.devicesetPrefix) && /^[A-Z]+$/.test(r.designator));
  return (
    <div className="modal-backdrop">
      <div className="modal card wide" role="dialog" aria-modal="true">
        <h2>Categories</h2>
        <p className="muted">
          Deviceset names become <code>PREFIX_TITLE</code>; the designator is the schematic prefix (C, R, U…); keywords are appended to the description.
        </p>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Name</th>
                <th>Deviceset prefix</th>
                <th>Designator</th>
                <th>Keywords</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={i}>
                  <td>
                    <input value={r.name} onChange={(e) => update(i, { name: e.target.value, id: r.id || slug(e.target.value) })} />
                  </td>
                  <td>
                    <input value={r.devicesetPrefix} onChange={(e) => update(i, { devicesetPrefix: e.target.value.toUpperCase() })} size={6} />
                  </td>
                  <td>
                    <input value={r.designator} onChange={(e) => update(i, { designator: e.target.value.toUpperCase() })} size={3} />
                  </td>
                  <td>
                    <input value={r.keywords} onChange={(e) => update(i, { keywords: e.target.value })} />
                  </td>
                  <td>
                    <button onClick={() => setRows(rows.filter((_, k) => k !== i))} title="Remove">
                      ✕
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="row space-between">
          <div className="row">
            <button onClick={() => setRows([...rows, { id: `custom-${Date.now()}`, name: '', devicesetPrefix: '', designator: 'X', keywords: '' }])}>Add category</button>
            <button onClick={() => setRows(DEFAULT_CATEGORIES.map((c) => ({ ...c })))}>Reset to defaults</button>
          </div>
          <div className="row">
            <button onClick={onClose}>Cancel</button>
            <button className="primary" disabled={!valid} onClick={() => onSave(rows.map((r) => ({ ...r, id: r.id || slug(r.name) })))}>
              Save
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
