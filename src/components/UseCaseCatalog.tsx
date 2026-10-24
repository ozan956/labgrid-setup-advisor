import type { CatalogEntry } from '../data';
import { Icon } from './Icons';

interface Props {
  entries: CatalogEntry[];
  onSelect: (id: string) => void;
}

export function UseCaseCatalog({ entries, onSelect }: Props) {
  return (
    <main id="main-content" className="page-shell catalog-page">
      <div className="section-kicker">Use-case catalog</div>
      <h1>What are you setting up?</h1>
      <p className="page-intro">Start with the outcome. The advisor will map it to verified Labgrid building blocks.</p>
      <div className="use-case-grid">
        {entries.map((entry, index) => {
          const available = entry.status === 'available';
          return (
            <article className={`use-case-card ${available ? 'is-available' : ''}`} key={entry.id}>
              <div className="card-index">0{index + 1}</div>
              <div className="use-case-icon"><Icon name={available ? 'power' : 'terminal'} /></div>
              <h2>{entry.title}</h2>
              <p>{entry.description}</p>
              {available ? (
                <button className="card-action" onClick={() => onSelect(entry.id)}>
                  Start guidance <Icon name="arrow" />
                </button>
              ) : (
                <span className="planned-badge">Planned</span>
              )}
            </article>
          );
        })}
      </div>
    </main>
  );
}

