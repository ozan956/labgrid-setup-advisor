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

