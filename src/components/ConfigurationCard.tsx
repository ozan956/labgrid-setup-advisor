import { useState } from 'react';
import type { GeneratedConfiguration } from '../engine/decision-engine';
import { downloadText } from './bench/shared';
import { Icon } from './Icons';

export function ConfigurationCard({ configuration }: { configuration: GeneratedConfiguration }) {
  const [copyState, setCopyState] = useState('Copy configuration');

  async function copy(): Promise<void> {
    try {
      await navigator.clipboard.writeText(configuration.content);
      setCopyState('Copied');
      window.setTimeout(() => setCopyState('Copy configuration'), 1600);
    } catch {
      setCopyState('Select and copy');
    }
  }

  return (
    <article className="config-card">
      <header>
        <div>
          <span className={`file-kind ${configuration.definition.kind}`}>{configuration.definition.kind}</span>
          <h3>{configuration.definition.title}</h3>
          <code>{configuration.definition.filename}</code>
        </div>
        <div className="file-actions">
          <button className="copy-button" onClick={copy} aria-live="polite" title={copyState}>
            <Icon name="copy" /> {copyState}
          </button>
          <button
            className="copy-button"
            onClick={() => downloadText(configuration.definition.filename, configuration.content)}
            aria-label={`Download ${configuration.definition.filename}`}
            title={`Download ${configuration.definition.filename}`}
          >
            <Icon name="download" /> Download
          </button>
        </div>
      </header>
      {configuration.ready ? (
        <div className="ready-notice"><Icon name="check" /> Ready to use</div>
      ) : (
        <div className="template-notice">
          <strong>Template — not ready to run</strong>
          <span>Replace {configuration.unresolved.length} required value{configuration.unresolved.length === 1 ? '' : 's'} first.</span>
        </div>
      )}
      <pre tabIndex={0}><code>{configuration.content}</code></pre>
      {configuration.unresolved.length > 0 && (
        <div className="placeholder-list">
          {configuration.unresolved.map((placeholder) => (
            <div key={placeholder.token}>
              <code>&lt;{placeholder.token}&gt;</code>
              <p><strong>{placeholder.label}.</strong> {placeholder.description} Example: <code>{placeholder.example}</code></p>
            </div>
          ))}
        </div>
      )}
    </article>
  );
}
