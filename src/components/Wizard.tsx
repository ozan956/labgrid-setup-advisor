import { useEffect, useRef } from 'react';
import { DecisionEngine } from '../engine/decision-engine';
import type { Answers, UseCaseDefinition } from '../engine/types';
import { Icon } from './Icons';

interface Props {
  definition: UseCaseDefinition;
  answers: Answers;
  questionIndex: number;
  onAnswer: (questionId: string, value: string) => void;
  onIndexChange: (index: number) => void;
  onComplete: () => void;
  onExit: () => void;
}

export function Wizard({
  definition,
  answers,
  questionIndex,
  onAnswer,
  onIndexChange,
  onComplete,
  onExit,
}: Props) {
  const engine = new DecisionEngine(definition);
  const visible = engine.visibleQuestions(answers);
  const safeIndex = Math.min(questionIndex, Math.max(visible.length - 1, 0));
  const question = visible[safeIndex];
  const headingRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    headingRef.current?.focus();
  }, [question?.id]);

  if (!question) return null;
  const selected = answers[question.id];
  const lastQuestion = safeIndex === visible.length - 1;

  return (
    <main id="main-content" className="wizard-page page-shell">
      <div className="wizard-topline">
        <button className="text-button" onClick={onExit}>← All use cases</button>
        <span>{definition.title}</span>
      </div>
      <div className="progress-wrap" aria-label={`Question ${safeIndex + 1} of ${visible.length}`}>
        <div className="progress-copy">
          <span>Question {safeIndex + 1}</span>
          <span>{visible.length} total</span>
        </div>
        <div className="progress-track">
          <div className="progress-value" style={{ width: `${((safeIndex + 1) / visible.length) * 100}%` }} />
        </div>
      </div>

      <section className="question-panel">
        <h1 ref={headingRef} tabIndex={-1}>{question.text}</h1>
        <p className="question-help">{question.help}</p>
        <div className="option-list" role="group" aria-label={question.text}>
          {question.options.map((option) => {
            const active = selected === option.value;
            return (
              <button
                className={`option-card ${active ? 'is-selected' : ''}`}
                key={option.value}
                aria-pressed={active}
                onClick={() => onAnswer(question.id, option.value)}
              >
                <span className="option-marker">{active ? <Icon name="check" /> : null}</span>
                <span>
                  <strong>{option.label}</strong>
                  <small>{option.description}</small>
                </span>
              </button>
            );
          })}
        </div>
      </section>

      <nav className="wizard-actions" aria-label="Question navigation">
        <button className="button secondary" disabled={safeIndex === 0} onClick={() => onIndexChange(safeIndex - 1)}>
          Previous
        </button>
        <button
          className="button primary"
          disabled={!selected}
          onClick={() => lastQuestion ? onComplete() : onIndexChange(safeIndex + 1)}
        >
          {lastQuestion ? 'Show my setup' : 'Next'} <Icon name="arrow" />
        </button>
      </nav>
    </main>
  );
}
