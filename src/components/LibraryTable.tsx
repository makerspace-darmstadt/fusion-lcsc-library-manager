import { useMemo, useState } from 'react';
import type { DevicesetSummary } from '../core/lbr/document.ts';

export function LibraryTable({ items, onRemove }: { items: DevicesetSummary[]; onRemove: (name: string) => void }) {
  const [filter, setFilter] = useState('');
  const shown = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return items;
    return items.filter((d) => [d.name, d.prefix, d.packages.join(' '), d.lcsc.join(' '), d.description].join(' ').toLowerCase().includes(q));
  }, [items, filter]);
  return (
    <section className="card">
      <div className="row space-between">
        <h2>
          Devicesets in library <span className="muted">({shown.length}/{items.length})</span>
        </h2>
        <input type="search" placeholder="Filter by name, package, LCSC…" value={filter} onChange={(e) => setFilter(e.target.value)} />
      </div>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Name</th>
              <th>Prefix</th>
              <th>Package</th>
              <th>LCSC</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {shown.map((d) => (
              <tr key={d.name} title={d.description}>
                <td>{d.name}</td>
                <td>{d.prefix}</td>
                <td>{d.packages.join(', ')}</td>
                <td>{d.lcsc.join(', ')}</td>
                <td>
                  <button className="small" onClick={() => onRemove(d.name)} title={`Remove ${d.name} from the library`}>
                    Remove
                  </button>
                </td>
              </tr>
            ))}
            {shown.length === 0 && (
              <tr>
                <td colSpan={5} className="muted">
                  {items.length === 0 ? 'The library is empty.' : 'No match.'}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}
