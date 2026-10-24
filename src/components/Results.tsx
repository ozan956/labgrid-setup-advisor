import { DecisionEngine } from '../engine/decision-engine';
import type { Answers, DocumentationReference, UseCaseDefinition } from '../engine/types';
import { ConfigurationCard } from './ConfigurationCard';
import { Icon } from './Icons';

interface Props {
  definition: UseCaseDefinition;
  answers: Answers;
  onEdit: () => void;
  onRestart: () => void;
}

export function Results({ definition, answers, onEdit, onRestart }: Props) {
  const engine = new DecisionEngine(definition);
  const matches = engine.recommendations(answers);
  const configurations = engine.configurations(answers);
  const documentationById = new Map(definition.documentation.map((reference) => [reference.id, reference]));
  const documentation = matches
    .flatMap(({ recommendation }) => recommendation.documentation)
    .filter((id, index, ids) => ids.indexOf(id) === index)
    .map((id) => documentationById.get(id))
    .filter((reference): reference is DocumentationReference => reference !== undefined);

  return (
    <main id="main-content" className="results-page page-shell">
      <section className="results-hero">
        <div>
          <div className="section-kicker">Recommendation ready</div>
          <h1>Your {definition.title} setup</h1>
          <p>Built from verified upstream components. Review every placeholder and hardware-specific requirement before using it.</p>
        </div>
        <div className="results-actions">
          <button className="button secondary" onClick={onEdit}>Review answers</button>
          <button className="text-button" onClick={onRestart}>Start over</button>
        </div>
      </section>

      <section className="result-section" aria-labelledby="approach-heading">
        <div className="result-section-heading">
          <div><h2 id="approach-heading">Recommended approach</h2><p>All matching guidance is shown; warnings are intentionally prominent.</p></div>
        </div>
        <div className="recommendation-stack">
          {matches.map(({ recommendation, matchedAnswers }) => (
            <article className={`recommendation-card ${recommendation.category}`} key={recommendation.id}>
              <div className="recommendation-label">{recommendation.category}</div>
              <h3>{recommendation.title}</h3>
              <p className="recommendation-summary">{recommendation.summary}</p>
              {matchedAnswers.length > 0 && <p className="answer-trace">Selected because: {matchedAnswers.join(' · ')}</p>}

              <div className="detail-grid">
                {recommendation.requirements.hardware.length > 0 && (
                  <div><h4>Required hardware</h4><ul>{recommendation.requirements.hardware.map((item) => <li key={item}>{item}</li>)}</ul></div>
                )}
                {recommendation.requirements.software.length > 0 && (
                  <div><h4>Required software</h4><ul>{recommendation.requirements.software.map((item) => <li key={item}>{item}</li>)}</ul></div>
                )}
              </div>

              {recommendation.components.length > 0 && (
                <div className="component-list">
                  {recommendation.components.map((component) => (
                    <div key={`${component.kind}-${component.name}`}>
                      <span>{component.kind}</span><strong>{component.name}</strong><p>{component.reason}</p>
                    </div>
                  ))}
                </div>
              )}

              {recommendation.architecture.length > 0 && (
                <div className="architecture-flow" aria-label="Architecture overview">
                  {recommendation.architecture.map((step, index) => (
                    <div className="architecture-step" key={`${recommendation.id}-${step.label}`}>
                      <div><strong>{step.label}</strong><span>{step.detail}</span></div>
                      {index < recommendation.architecture.length - 1 && <Icon name="arrow" />}
                    </div>
                  ))}
                </div>
              )}

              {recommendation.commands.length > 0 && (
                <div className="command-list">
                  <h4>Relevant commands</h4>
                  {recommendation.commands.map((item) => (
                    <div key={item.command}><code>{item.command}</code><span>{item.description}</span></div>
                  ))}
                </div>
              )}
            </article>
          ))}
        </div>
      </section>

      <section className="result-section" aria-labelledby="config-heading">
        <div className="result-section-heading">
          <div><h2 id="config-heading">Configuration templates</h2><p>Exporter and client files are separated. Angle-bracket values must be replaced.</p></div>
        </div>
        {configurations.length > 0 ? (
          <div className="configuration-stack">
            {configurations.map((configuration) => (
              <ConfigurationCard key={configuration.definition.id} configuration={configuration} />
            ))}
          </div>
        ) : (
          <div className="no-config">
            <strong>No safe configuration generated</strong>
            <p>This answer combination needs a verified controller or backend before Labgrid YAML can be useful.</p>
          </div>
        )}
      </section>

      <section className="result-section references" aria-labelledby="docs-heading">
        <div className="result-section-heading">
          <div><h2 id="docs-heading">Upstream references</h2><p>Confirm model-specific details against current Labgrid and hardware documentation.</p></div>
        </div>
        <div className="reference-grid">
          {documentation.map((reference) => (
            <a href={reference.url} target="_blank" rel="noreferrer" key={reference.id}>
              <span>{reference.title}</span><Icon name="arrow" />
            </a>
          ))}
        </div>
      </section>
    </main>
  );
}
