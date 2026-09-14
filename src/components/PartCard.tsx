import type { Category } from '../core/categories.ts';
import type { ConvertedPart } from '../core/eagle/convert.ts';
import type { PartSvgs } from '../core/easyeda/fetch.ts';
import type { PartModel } from '../core/easyeda/types.ts';
import type { MergePlan } from '../core/lbr/merge.ts';
import { openExternal } from '../tauri/adapters.ts';
import { WarningList } from './WarningList.tsx';

interface Props {
  model: PartModel;
  svgs: PartSvgs | null;
  categories: Category[];
  categoryId: string;
  onCategoryChange: (id: string) => void;
  converted: ConvertedPart;
  plan: MergePlan | null;
  canAdd: boolean;
  busy: boolean;
  onAdd: () => void;
}

export function PartCard({ model, svgs, categories, categoryId, onCategoryChange, converted, plan, canAdd, busy, onAdd }: Props) {
  const { info } = model;
  const pinCount = model.units.reduce((n, u) => n + u.pins.length, 0);
  return (
    <section className="card part-card">
      <div className="part-head">
        <div>
          <h2>
            {info.title} <span className="muted">({info.lcsc})</span>
          </h2>
          {info.description && <p>{info.description}</p>}
          <dl className="facts">
            <dt>Package</dt>
            <dd>{info.packageName}</dd>
            <dt>Manufacturer</dt>
            <dd>{[info.manufacturer, info.mpn].filter(Boolean).join(' ') || '—'}</dd>
            <dt>Pins / pads</dt>
            <dd>
              {pinCount} / {model.footprint.pads.length}
              {model.units.length > 1 && ` (${model.units.length} units)`}
            </dd>
            {info.jlcClass && (
              <>
                <dt>JLCPCB</dt>
                <dd>{info.jlcClass}</dd>
              </>
            )}
            <dt>Links</dt>
            <dd>
              {info.productUrl ? (
                <a href={info.productUrl} onClick={(e) => { e.preventDefault(); openExternal(info.productUrl!); }}>
                  LCSC product page (datasheet)
                </a>
              ) : (
                '—'
              )}
            </dd>
          </dl>
        </div>
        <div className="previews">
          <figure>
            <div className="preview preview-symbol" dangerouslySetInnerHTML={{ __html: svgs?.symbol ?? '' }} />
            <figcaption>Symbol</figcaption>
          </figure>
          <figure>
            <div className="preview preview-footprint" dangerouslySetInnerHTML={{ __html: svgs?.footprint ?? '' }} />
            <figcaption>Footprint</figcaption>
          </figure>
        </div>
      </div>

      <div className="row">
        <label>
          Category{' '}
          <select value={categoryId} onChange={(e) => onCategoryChange(e.target.value)}>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name} ({c.devicesetPrefix}_… / {c.designator})
              </option>
            ))}
          </select>
        </label>
        <span className="muted">
          → deviceset <code>{converted.devicesetName}</code>, package <code>{converted.packageName}</code>
        </span>
      </div>

      {plan && (
        <p className="muted">
          {plan.alreadyPresentAs
            ? `Already in the library as ${plan.alreadyPresentAs}.`
            : [
                ...plan.packages.map((p) => `package ${p.name}: ${p.status}`),
                ...plan.symbols.map((p) => `symbol ${p.name}: ${p.status}`),
                plan.devicesetRenamedTo ? `deviceset will be imported as ${plan.devicesetRenamedTo}` : null,
              ]
                .filter(Boolean)
                .join(' · ')}
        </p>
      )}

      <WarningList warnings={converted.warnings} />

      <div className="row">
        <button className="primary" disabled={!canAdd || busy} onClick={onAdd}>
          {busy ? 'Adding…' : 'Add to library'}
        </button>
        {converted.hasErrors && <span className="sev-error">Not importable: fix the errors above.</span>}
        {!converted.hasErrors && plan?.alreadyPresentAs && <span className="muted">Nothing to add.</span>}
      </div>
    </section>
  );
}
