import { describe, expect, it } from 'vitest';
import { DecisionEngine } from '../src/engine/decision-engine';
import { validDefinition } from './fixtures/definition';

describe('DecisionEngine', () => {
  it('follows conditional question paths', () => {
    const engine = new DecisionEngine(validDefinition());
    expect(engine.nextQuestion({})?.id).toBe('power-source');
    expect(engine.visibleQuestions({ 'power-source': 'external' }).map(({ id }) => id)).toEqual(['power-source']);
    expect(engine.visibleQuestions({ 'power-source': 'usb' }).map(({ id }) => id)).toEqual([
      'power-source',
      'usb-kind',
    ]);
  });

  it('reports missing and inconsistent answers', () => {
    const engine = new DecisionEngine(validDefinition());
    expect(engine.answerStatus({ 'power-source': 'usb' }).missing.map(({ id }) => id)).toEqual(['usb-kind']);
    expect(engine.answerStatus({ 'power-source': 'external', 'usb-kind': 'hub' }).inconsistent).toHaveLength(1);
    expect(engine.answerStatus({ unknown: 'value' }).inconsistent[0].message).toBe('Unknown question.');
  });

  it('rejects invalid options', () => {
    const engine = new DecisionEngine(validDefinition());
    expect(() => engine.setAnswer({}, 'power-source', 'solar')).toThrow(
      'Invalid option "solar" for question "power-source"',
    );
  });

  it('removes downstream answers which become hidden', () => {
    const engine = new DecisionEngine(validDefinition());
    const changed = engine.setAnswer({ 'power-source': 'usb', 'usb-kind': 'ykush' }, 'power-source', 'external');
    expect(changed).toEqual({ 'power-source': 'external' });
  });

  it('returns all matching recommendations with an answer trace', () => {
    const definition = validDefinition();
    definition.recommendations.push({
      ...definition.recommendations[0],
      id: 'usb-safety',
      category: 'warning',
      title: 'Check the load',
    });
    const engine = new DecisionEngine(definition);
    const matches = engine.recommendations({ 'power-source': 'usb', 'usb-kind': 'hub' });
    expect(matches.map(({ recommendation }) => recommendation.id)).toEqual(['usb-power', 'usb-safety']);
    expect(matches[0].matchedAnswers).toEqual(['Power source? USB']);
  });

  it('withholds recommendations until required answers are complete', () => {
    const engine = new DecisionEngine(validDefinition());
    expect(engine.recommendations({ 'power-source': 'usb' })).toEqual([]);
  });
});

