import type { CatalogEntry } from '../data';
import { Icon } from './Icons';

interface Props {
  entries: CatalogEntry[];
  onSelect: (id: string) => void;
}

export function UseCaseCatalog({ entries, onSelect }: Props) {
  const available = entries.filter((entry) => entry.status === 'available');
  const planned = entries.filter((entry) => entry.status === 'planned');

  return (
    <main id="main-content" className="page-shell catalog-page">
      <div className="section-kicker">Use-case catalog</div>
      <h1>What are you setting up?</h1>
      <p className="page-intro">Start with the outcome. The advisor will map it to verified Labgrid building blocks.</p>
      <div className="use-case-grid">
        {available.map((entry) => (
          <article className="use-case-card" key={entry.id}>
            <div className="use-case-icon"><Icon name="power" /></div>
            <h2>{entry.title}</h2>
            <p>{entry.description}</p>
            <button className="card-action" onClick={() => onSelect(entry.id)}>
              Start guidance <Icon name="arrow" />
            </button>
          </article>
        ))}
      </div>
      <p className="planned-note">
        Planned next: {planned.map(({ title }) => title).join(', ')}.
      </p>
    </main>
  );
}
