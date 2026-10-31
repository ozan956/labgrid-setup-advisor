import type { Prefill } from '../bench/types';
import { createZip } from '../bench/zip';
import { DecisionEngine, type PlaceholderValues } from '../engine/decision-engine';
import type { Answers, DocumentationReference, UseCaseDefinition } from '../engine/types';
import { downloadBytes } from './bench/shared';
import { ConfigurationCard } from './ConfigurationCard';
import { Icon } from './Icons';

interface Props {
  definition: UseCaseDefinition;
  answers: Answers;
  values: PlaceholderValues;
  prefill?: Prefill;
  onValuesChange: (values: PlaceholderValues) => void;
  onEdit: () => void;
  onRestart: () => void;
}

const categoryLabels = {
  approach: 'Recommended method',
  topology: 'Where it runs',
  warning: 'Check this first',
};

export function Results({ definition, answers, values, prefill, onValuesChange, onEdit, onRestart }: Props) {
  const engine = new DecisionEngine(definition);
  const matches = engine.recommendations(answers);
  const configurations = engine.configurations(answers, values);
  const placeholders = engine.placeholders(answers);
  const allReady = configurations.length > 0 && configurations.every((configuration) => configuration.ready);
  const nextSteps = matches
    .flatMap(({ recommendation }) => recommendation.nextSteps ?? [])
    .filter((step, index, steps) => steps.indexOf(step) === index);
  const documentationById = new Map(definition.documentation.map((reference) => [reference.id, reference]));
  const documentation = matches
    .flatMap(({ recommendation }) => recommendation.documentation)
    .filter((id, index, ids) => ids.indexOf(id) === index)
    .map((id) => documentationById.get(id))
    .filter((reference): reference is DocumentationReference => reference !== undefined);

  function downloadAll(): void {
    const archive = createZip(configurations.map((configuration) => ({ name: configuration.definition.filename, content: configuration.content })));
    downloadBytes(`labgrid-${definition.id}.zip`, archive);
  }

  const configurationCards = (
    <div className="configuration-stack">
      {configurations.map((configuration) => (
        <ConfigurationCard key={configuration.definition.id} configuration={configuration} />
      ))}
    </div>
  );

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
          <div>
            <h2 id="config-heading">{allReady ? 'Configuration' : 'Configuration (optional)'}</h2>
            <p>{allReady ? 'Every value is filled in. Copy or download the files.' : 'Use these templates when you are ready to configure Labgrid.'}</p>
          </div>
          {configurations.length > 1 && (
            <button className="button secondary" onClick={downloadAll}><Icon name="arrow" /> Download all (.zip)</button>
          )}
        </div>

        {configurations.length > 0 && placeholders.length > 0 && (
          <section className="values-form" aria-labelledby="values-heading">
            <h3 id="values-heading">Your values</h3>
            <p className="configuration-note">Type the values for your hardware. The files below update as you type.</p>
            <div className="values-grid">
              {placeholders.map((placeholder) => {
                const id = `value-${placeholder.token}`;
                const fromBench = prefill !== undefined && values[placeholder.token] !== undefined && values[placeholder.token] === prefill.values[placeholder.token];
                return (
                  <div className="field" key={placeholder.token}>
                    <label htmlFor={id}>
                      {placeholder.label}
                      {fromBench && <span className="prefill-chip small">from your bench</span>}
                    </label>
                    <input
                      id={id}
                      value={values[placeholder.token] ?? ''}
                      placeholder={placeholder.example}
                      aria-describedby={`${id}-hint`}
                      onChange={(event) => onValuesChange({ ...values, [placeholder.token]: event.target.value })}
                    />
                    <small id={`${id}-hint`}>{placeholder.description} Example: <code>{placeholder.example}</code></small>
                  </div>
                );
              })}
            </div>
          </section>
        )}

        {configurations.length > 0 ? (
          allReady ? configurationCards : (
            <details className="configuration-disclosure">
              <summary>Show {configurations.length} generated YAML {configurations.length === 1 ? 'file' : 'files'}</summary>
              <p className="configuration-note">Exporter and client files are separate. Replace every marked placeholder before use.</p>
              {configurationCards}
            </details>
          )
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
