import { parse } from 'yaml';
import { describe, expect, it } from 'vitest';
import { DecisionEngine } from '../src/engine/decision-engine';
import { validDefinition } from './fixtures/definition';

describe('configuration generation', () => {
  it('selects the template for the completed path', () => {
    const engine = new DecisionEngine(validDefinition());
    const generated = engine.configurations({ 'power-source': 'external' });
    expect(generated).toHaveLength(1);
    expect(generated[0].definition.id).toBe('external-environment');
  });

  it('renders answer substitutions and keeps hardware placeholders explicit', () => {
    const engine = new DecisionEngine(validDefinition());
    const [generated] = engine.configurations({ 'power-source': 'usb', 'usb-kind': 'ykush' });
    expect(generated.content).toBe('index: <PORT_INDEX>\n# ykush\n');
    expect(generated.unresolved.map(({ token }) => token)).toEqual(['PORT_INDEX']);
    expect(generated.ready).toBe(false);
  });

  it('generates stable, valid YAML templates', () => {
    const engine = new DecisionEngine(validDefinition());
    const first = engine.configurations({ 'power-source': 'external' })[0].content;
    const second = engine.configurations({ 'power-source': 'external' })[0].content;
    expect(first).toBe(second);
    expect(parse(first)).toEqual({ host: '<PDU_HOST>' });
  });

  it('returns no configuration for incomplete or unsupported combinations', () => {
    const definition = validDefinition();
    definition.configurations = definition.configurations.filter(({ id }) => id !== 'external-environment');
    const engine = new DecisionEngine(definition);
    expect(engine.configurations({})).toEqual([]);
    expect(engine.configurations({ 'power-source': 'external' })).toEqual([]);
  });
});


describe('placeholder values', () => {
  it('substitutes supplied values and reports the file as ready', () => {
    const engine = new DecisionEngine(validDefinition());
    const [generated] = engine.configurations({ 'power-source': 'external' }, { PDU_HOST: 'pdu-01.lab' });
    expect(generated.content).toBe('host: pdu-01.lab\n');
    expect(generated.unresolved).toEqual([]);
    expect(generated.ready).toBe(true);
    expect(generated.applied).toEqual({ PDU_HOST: 'pdu-01.lab' });
    expect(parse(generated.content)).toEqual({ host: 'pdu-01.lab' });
  });

  it('keeps unquoted numbers bare and quotes anything else safely', () => {
    const engine = new DecisionEngine(validDefinition());
    const numeric = engine.configurations({ 'power-source': 'usb', 'usb-kind': 'ykush' }, { PORT_INDEX: '3' });
    expect(numeric[0].content).toBe('index: 3\n# ykush\n');
    const text = engine.configurations({ 'power-source': 'usb', 'usb-kind': 'ykush' }, { PORT_INDEX: 'a: b' });
    expect(parse(text[0].content)).toEqual({ index: 'a: b' });
    const quoted = engine.configurations({ 'power-source': 'external' }, { PDU_HOST: "it's" });
    expect(parse(quoted[0].content)).toEqual({ host: "it's" });
  });

  it('keeps significant whitespace in substituted values', () => {
    const engine = new DecisionEngine(validDefinition());
    const [generated] = engine.configurations({ 'power-source': 'external' }, { PDU_HOST: ' login: ' });
    expect(parse(generated.content)).toEqual({ host: ' login: ' });
    expect(generated.applied).toEqual({ PDU_HOST: ' login: ' });
  });

  it('ignores blank values and values for undeclared tokens', () => {
    const engine = new DecisionEngine(validDefinition());
    const [generated] = engine.configurations({ 'power-source': 'external' }, { PDU_HOST: '  ', OTHER: 'x' });
    expect(generated.content).toBe('host: <PDU_HOST>\n');
    expect(generated.ready).toBe(false);
    expect(generated.applied).toEqual({});
  });

  it('lists the placeholders of every selected configuration once', () => {
    const engine = new DecisionEngine(validDefinition());
    expect(engine.placeholders({ 'power-source': 'external' }).map(({ token }) => token)).toEqual(['PDU_HOST']);
    expect(engine.placeholders({})).toEqual([]);
  });
});
