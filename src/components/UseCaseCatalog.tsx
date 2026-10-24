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
      <h2>Choose a setup</h2>
      <p className="page-intro">Start with the outcome. The advisor will map it to verified Labgrid building blocks.</p>
      <div className="use-case-grid">
        {available.map((entry) => (
          <article className="use-case-card" key={entry.id}>
            <h2>{entry.title}</h2>
            <p>{entry.description}</p>
            <button className="card-action" aria-label={`Open ${entry.title} guide`} onClick={() => onSelect(entry.id)}>
              Open guide <Icon name="arrow" />
            </button>
          </article>
        ))}
      </div>
    </section>
  );
}
