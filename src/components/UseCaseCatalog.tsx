import type { CatalogEntry } from '../data';
import { Icon } from './Icons';

interface Props {
  entries: CatalogEntry[];
  onSelect: (id: string) => void;
}

export function UseCaseCatalog({ entries, onSelect }: Props) {
  const available = entries.filter((entry) => entry.status === 'available');

  return (
    <section id="use-cases" className="catalog-page">
      <h1>Choose a setup</h1>
      <p className="page-intro">Pick the outcome closest to what you need. You do not need to know Labgrid class names.</p>
      <div className="use-case-grid">
        {available.map((entry) => (
          <article className="use-case-card" key={entry.id}>
            <h2>{entry.title}</h2>
            <p>{entry.description}</p>
            <button className="card-action" aria-label={`Open ${entry.title} guide`} onClick={() => onSelect(entry.id)}>
              Start setup <Icon name="arrow" />
            </button>
          </article>
        ))}
      </div>
    </section>
  );
}
