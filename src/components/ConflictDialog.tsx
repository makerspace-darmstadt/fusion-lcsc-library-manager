import { useState } from 'react';
import type { ElementPlan, Resolution } from '../core/lbr/merge.ts';

interface Props {
  conflicts: ElementPlan[];
  onCancel: () => void;
  onConfirm: (resolutions: Record<string, Resolution>) => void;
}

export function ConflictDialog({ conflicts, onCancel, onConfirm }: Props) {
  const [choices, setChoices] = useState<Record<string, Resolution>>(() => Object.fromEntries(conflicts.map((c) => [`${c.kind}:${c.name}`, 'reuse'])));
  return (
    <div className="modal-backdrop">
      <div className="modal card" role="dialog" aria-modal="true">
        <h2>Existing elements differ</h2>
        <p>
          The library already contains elements with these names, but their content differs from the imported part. Choose per element whether to keep the
          existing one or import the new one under a suffixed name.
        </p>
        <table>
          <thead>
            <tr>
              <th>Element</th>
              <th>Reuse existing</th>
              <th>Import as NAME_2</th>
            </tr>
          </thead>
          <tbody>
            {conflicts.map((c) => {
              const key = `${c.kind}:${c.name}`;
              return (
                <tr key={key}>
                  <td>
                    {c.kind} <code>{c.name}</code>
                  </td>
                  <td>
                    <input type="radio" name={key} checked={choices[key] === 'reuse'} onChange={() => setChoices({ ...choices, [key]: 'reuse' })} />
                  </td>
                  <td>
                    <input type="radio" name={key} checked={choices[key] === 'rename'} onChange={() => setChoices({ ...choices, [key]: 'rename' })} />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <div className="row end">
          <button onClick={onCancel}>Cancel</button>
          <button className="primary" onClick={() => onConfirm(choices)}>
            Add to library
          </button>
        </div>
      </div>
    </div>
  );
}
