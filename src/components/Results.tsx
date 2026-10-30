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

const categoryLabels = {
  approach: 'Recommended method',
  topology: 'Where it runs',
  warning: 'Check this first',
};

export function Results({ definition, answers, onEdit, onRestart }: Props) {
  const engine = new DecisionEngine(definition);
  const matches = engine.recommendations(answers);
  const configurations = engine.configurations(answers);
  const nextSteps = matches
    .flatMap(({ recommendation }) => recommendation.nextSteps ?? [])
    .filter((step, index, steps) => steps.indexOf(step) === index);
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
          <div className="section-kicker">Your next steps</div>
          <h1>Your {definition.title} setup</h1>
          <p>Start with the recommendation below. Open technical details only when you need class names, commands, or wiring requirements.</p>
        </div>
        <div className="results-actions">
          <button className="button secondary" onClick={onEdit}>Review answers</button>
          <button className="text-button" onClick={onRestart}>Start over</button>
        </div>
      </section>

      <section className="result-section" aria-labelledby="approach-heading">
        <div className="result-section-heading">
          <div><h2 id="approach-heading">What to do</h2><p>These steps match your answers. Safety checks stay visible.</p></div>
        </div>
        {nextSteps.length > 0 && (
          <section className="next-steps" aria-labelledby="next-steps-heading">
            <h3 id="next-steps-heading">Start here</h3>
            <ol>{nextSteps.map((step) => <li key={step}>{step}</li>)}</ol>
          </section>
        )}
        <div className="recommendation-stack">
          {matches.map(({ recommendation, matchedAnswers }) => (
            <article className={`recommendation-card ${recommendation.category}`} key={recommendation.id}>
              <div className="recommendation-label">{categoryLabels[recommendation.category]}</div>
              <h3>{recommendation.title}</h3>
              <p className="recommendation-summary">{recommendation.summary}</p>
              {matchedAnswers.length > 0 && <p className="answer-trace">Based on your answers: {matchedAnswers.join(' · ')}</p>}

              <details className="technical-details" open={recommendation.category === 'warning'}>
                <summary>Show why, requirements, Labgrid parts, and commands</summary>
                <div className="technical-details-body">
                  {recommendation.why.length > 0 && (
                    <div className="why-list">
                      <h4>Why this fits</h4>
                      <ul>{recommendation.why.map((reason) => <li key={reason}>{reason}</li>)}</ul>
                    </div>
                  )}
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
                </div>
              </details>
            </article>
          ))}
        </div>
      </section>

      <section className="result-section" aria-labelledby="config-heading">
        <div className="result-section-heading">
          <div><h2 id="config-heading">Configuration (optional)</h2><p>Use these templates when you are ready to configure Labgrid.</p></div>
        </div>
        {configurations.length > 0 ? (
          <details className="configuration-disclosure">
            <summary>Show {configurations.length} generated YAML {configurations.length === 1 ? 'file' : 'files'}</summary>
            <p className="configuration-note">Exporter and client files are separate. Replace every marked placeholder before use.</p>
            <div className="configuration-stack">
              {configurations.map((configuration) => (
                <ConfigurationCard key={configuration.definition.id} configuration={configuration} />
              ))}
            </div>
          </details>
        ) : (
          <div className="no-config">
            <strong>No safe configuration generated</strong>
            <p>One more hardware detail is needed before safe YAML can be generated. Follow the check above, then review your answers.</p>
          </div>
        )}
      </section>

      <section className="result-section references" aria-labelledby="docs-heading">
        <div className="result-section-heading">
          <div><h2 id="docs-heading">Learn more</h2><p>Use the upstream documentation to confirm model-specific details.</p></div>
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
