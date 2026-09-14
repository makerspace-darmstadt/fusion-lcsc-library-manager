import type { ConversionWarning } from '../core/warnings.ts';

export function WarningList({ warnings }: { warnings: ConversionWarning[] }) {
  if (warnings.length === 0) return <p className="muted">No conversion warnings.</p>;
  const counts = { error: 0, warning: 0, info: 0 };
  for (const w of warnings) counts[w.severity]++;
  return (
    <details className="warnings" open={counts.error > 0}>
      <summary>
        Conversion notes: {counts.error > 0 && <span className="sev-error">{counts.error} error(s)</span>}{' '}
        {counts.warning > 0 && <span className="sev-warning">{counts.warning} warning(s)</span>} {counts.info > 0 && <span className="sev-info">{counts.info} info</span>}
      </summary>
      <ul>
        {warnings.map((w, i) => (
          <li key={i} className={`sev-${w.severity}`} title={w.raw ?? ''}>
            <code>{w.code}</code> {w.message}
          </li>
        ))}
      </ul>
    </details>
  );
}
