import { describe, expect, it } from 'vitest';
import automatedSource from '../src/data/automated-hardware-testing.yaml?raw';
import farmSource from '../src/data/board-farm-setup.yaml?raw';
import ciSource from '../src/data/ci-integration.yaml?raw';
import firmwareSource from '../src/data/firmware-flashing.yaml?raw';
import remoteAccessSource from '../src/data/remote-board-access.yaml?raw';
import serialSource from '../src/data/serial-console-access.yaml?raw';
import { DecisionEngine } from '../src/engine/decision-engine';
import { loadDefinition } from '../src/engine/load';

const sources = [
  serialSource,
  firmwareSource,
  automatedSource,
  ciSource,
  remoteAccessSource,
  farmSource,
];

describe('additional setup workflows', () => {
  it.each(sources)('loads every definition and completes its default path', (source) => {
    const definition = loadDefinition(source);
    const engine = new DecisionEngine(definition);
    let answers = {};

    let question = engine.nextQuestion(answers);
    while (question) {
      answers = engine.setAnswer(answers, question.id, question.options[0].value);
      question = engine.nextQuestion(answers);
    }

    expect(engine.answerStatus(answers).complete).toBe(true);
    expect(engine.recommendations(answers).length).toBeGreaterThan(0);
    expect(engine.configurations(answers).length).toBeGreaterThan(0);
  });
});
