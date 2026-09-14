import { useState } from 'react';
import type { RemovalPlan } from '../core/lbr/remove.ts';

interface Props {
  plan: RemovalPlan;
  busy: boolean;
  onCancel: () => void;
  onConfirm: (removeOrphans: boolean) => void;
}

export function RemoveDialog({ plan, busy, onCancel, onConfirm }: Props) {
  const orphans = [...plan.orphanPackages.map((p) => `package ${p}`), ...plan.orphanSymbols.map((s) => `symbol ${s}`)];
  const [removeOrphans, setRemoveOrphans] = useState(true);
  return (
    <div className="modal-backdrop">
      <div className="modal card" role="dialog" aria-modal="true">
        <h2>Remove {plan.devicesetName}?</h2>
        <p>The deviceset is deleted from the library file. The previous version is kept as a .bak file.</p>
        {orphans.length > 0 ? (
          <label className="row">
            <input type="checkbox" checked={removeOrphans} onChange={(e) => setRemoveOrphans(e.target.checked)} />
            <span>
              Also remove elements no other deviceset uses: <code>{orphans.join(', ')}</code>
            </span>
          </label>
        ) : (
          <p className="muted">Its package and symbol are still used by other devicesets and stay in the library.</p>
        )}
        <div className="row end">
          <button onClick={onCancel} disabled={busy}>
            Cancel
          </button>
          <button className="primary danger" disabled={busy} onClick={() => onConfirm(removeOrphans)}>
            {busy ? 'Removing…' : 'Remove'}
          </button>
        </div>
      </div>
    </div>
  );
}
