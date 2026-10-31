import type { Prefill } from '../bench/types';
import type { CatalogEntry } from '../data';
import { Icon } from './Icons';

interface Props {
  entries: CatalogEntry[];
  prefills?: Map<string, Prefill>;
  onSelect: (id: string) => void;
}

export function UseCaseCatalog({ entries, prefills, onSelect }: Props) {
  const available = entries.filter((entry) => entry.status === 'available');

  return (
    <section id="use-cases" className="catalog-page">
      <h2 className="catalog-heading">Choose a setup</h2>
      <p className="page-intro">Pick the outcome closest to what you need. You do not need to know Labgrid class names.</p>
      <div className="use-case-grid">
        {available.map((entry) => {
          const prefill = prefills?.get(entry.id);
          const prefilled = prefill !== undefined && Object.keys(prefill.answers).length > 0;
          return (
            <article className="use-case-card" key={entry.id}>
              {prefilled && <span className="prefill-chip">Pre-filled from your bench</span>}
              <h3>{entry.title}</h3>
              <p>{entry.description}</p>
              {prefill?.relevance && <p className="guide-relevance">{prefill.relevance}</p>}
              <button className="card-action" aria-label={`Open ${entry.title} guide`} onClick={() => onSelect(entry.id)}>
                Start setup <Icon name="arrow" />
              </button>
            </article>
          );
        })}
      </div>
    </section>
  );
}
