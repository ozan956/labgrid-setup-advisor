import { describe, expect, it } from 'vitest';
import { validateDefinition } from '../src/engine/validate';
import { validDefinition } from './fixtures/definition';

describe('use-case validation', () => {
  it('accepts a valid definition', () => {
    expect(validateDefinition(validDefinition())).toEqual({ valid: true, errors: [] });
  });

  it('reports missing required fields', () => {
    const definition = validDefinition() as unknown as Record<string, unknown>;
    delete definition.title;
    expect(validateDefinition(definition).errors.join('\n')).toContain("must have required property 'title'");
  });

  it('reports duplicate identifiers', () => {
    const definition = validDefinition();
    definition.questions.push({ ...definition.questions[0] });
    expect(validateDefinition(definition).errors).toContain('duplicate question id "power-source"');
  });

  it('reports unknown question references', () => {
    const definition = validDefinition();
    definition.recommendations[0].when = { all: [{ question: 'missing-question', equals: 'usb' }] };
    expect(validateDefinition(definition).errors).toContain(
      'recommendation "usb-power" references unknown question "missing-question"',
    );
  });

  it('reports invalid condition values', () => {
    const definition = validDefinition();
    definition.recommendations[0].when = { all: [{ question: 'power-source', equals: 'battery' }] };
    expect(validateDefinition(definition).errors).toContain(
      'recommendation "usb-power" references invalid option "battery" for "power-source"',
    );
  });

  it('reports broken documentation references', () => {
    const definition = validDefinition();
    definition.recommendations[0].documentation = ['missing-doc'];
    expect(validateDefinition(definition).errors).toContain(
      'recommendation "usb-power" references unknown documentation "missing-doc"',
    );
  });

  it('reports circular question dependencies', () => {
    const definition = validDefinition();
    definition.questions[0].visibleWhen = { all: [{ question: 'usb-kind', equals: 'hub' }] };
    expect(validateDefinition(definition).errors.some((error) => error.includes('circular question dependency'))).toBe(true);
  });

  it('reports unreachable questions', () => {
    const definition = validDefinition();
    definition.questions[1].visibleWhen = {
      all: [
        { question: 'power-source', equals: 'usb' },
        { question: 'power-source', equals: 'external' },
      ],
    };
    expect(validateDefinition(definition).errors).toContain('question "usb-kind" is unreachable');
  });

  it('reports placeholder contract errors', () => {
    const definition = validDefinition();
    definition.configurations[0].template += '# {{UNDECLARED}}\n';
    expect(validateDefinition(definition).errors).toContain(
      'configuration "usb-environment" uses undeclared placeholder "UNDECLARED"',
    );
  });
});
