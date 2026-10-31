import type { GeneratedFile } from '../../bench/types';
import { Icon } from '../Icons';
import { CopyButton, TargetBadge, downloadText } from './shared';

const KIND_LABELS: Record<GeneratedFile['kind'], string> = {
  exporter: 'exporter',
  environment: 'environment',
  notes: 'notes',
  script: 'script',
  service: 'systemd',
  profile: 'profile',
};

export function GeneratedFileCard({ file, collapsed = false }: { file: GeneratedFile; collapsed?: boolean }) {
  const body = (
    <>
      {file.unresolved.length > 0 ? (
        <div className="template-notice">
          <strong>Template: {file.unresolved.length} {file.unresolved.length === 1 ? 'value' : 'values'} missing</strong>
          <span>Fill {file.unresolved.map((token) => `<${token}>`).join(', ')} in the bench editor or in the file.</span>
        </div>
      ) : (
        file.kind !== 'notes' && file.kind !== 'profile' && (
          <div className="ready-notice"><Icon name="check" /> Ready to use</div>
        )
      )}
      <pre tabIndex={0}><code>{file.content}</code></pre>
    </>
  );

  return (
    <article className="config-card generated-file">
      <header>
        <div>
          <span className={`file-kind ${file.kind}`}>{KIND_LABELS[file.kind]}</span>
          <h3>{file.title}</h3>
          <code>{file.filename}</code>
          <TargetBadge target={file.target} />
        </div>
        <div className="file-actions">
          <CopyButton text={file.content} label="Copy" />
          <button className="copy-button" type="button" onClick={() => downloadText(file.filename, file.content)}>
            <Icon name="arrow" /> Download
          </button>
        </div>
      </header>
      <p className="file-description">{file.description}</p>
      {collapsed ? (
        <details className="file-disclosure">
          <summary>Show {file.filename}</summary>
          {body}
        </details>
      ) : body}
    </article>
  );
}
