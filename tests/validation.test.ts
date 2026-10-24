import { describe, expect, it } from 'vitest';
import type { UseCaseDefinition } from '../src/engine/types';
import { validateDefinition } from '../src/engine/validate';

function validDefinition(): UseCaseDefinition {
  return {
    schemaVersion: 1,
    id: 'test-case',
    title: 'Test case',
    description: 'A test definition.',
    questions: [
      {
        id: 'power-source',
        text: 'Power source?',
        help: 'Choose one.',
        options: [
          { value: 'usb', label: 'USB', description: 'USB powered.' },
          { value: 'external', label: 'External', description: 'External supply.' },
        ],
      },
      {
        id: 'usb-kind',
        text: 'Which USB controller?',
        help: 'Choose one.',
        visibleWhen: { all: [{ question: 'power-source', equals: 'usb' }] },
        options: [
          { value: 'hub', label: 'Hub', description: 'Generic smart hub.' },
          { value: 'ykush', label: 'YKUSH', description: 'Yepkit YKUSH.' },
        ],
      },
    ],
    recommendations: [
      {
        id: 'usb-power',
        category: 'approach',
        title: 'USB power',
        summary: 'Switch USB power.',
        when: { all: [{ question: 'power-source', equals: 'usb' }] },
        why: ['The board is USB powered.'],
        requirements: { hardware: ['Smart hub'], software: ['uhubctl'] },
        components: [{ kind: 'driver', name: 'USBPowerDriver', reason: 'Controls the port.' }],
        architecture: [{ label: 'Host', detail: 'Runs the driver.' }],
        commands: [{ command: 'labgrid-client power cycle', description: 'Cycle power.' }],
        documentation: ['configuration'],
      },
      {
        id: 'external-power',
        category: 'approach',
        title: 'External power',
        summary: 'Switch an outlet.',
        when: { all: [{ question: 'power-source', equals: 'external' }] },
        why: ['The board has an external supply.'],
        requirements: { hardware: ['PDU'], software: [] },
        components: [],
        architecture: [],
        commands: [],
        documentation: ['configuration'],
      },
    ],
    configurations: [
      {
        id: 'usb-environment',
        title: 'Environment',
        filename: 'environment.yaml',
        kind: 'environment',
        when: { all: [{ question: 'power-source', equals: 'usb' }] },
        template: 'index: {{PORT_INDEX}}\n# {{answer:usb-kind}}\n',
        placeholders: [
          {
            token: 'PORT_INDEX',
            label: 'Port',
            description: 'Downstream port.',
            example: '1',
            required: true,
          },
        ],
      },
      {
        id: 'external-environment',
        title: 'Environment',
        filename: 'environment.yaml',
        kind: 'environment',
        when: { all: [{ question: 'power-source', equals: 'external' }] },
        template: 'host: {{PDU_HOST}}\n',
        placeholders: [
          {
            token: 'PDU_HOST',
            label: 'PDU host',
            description: 'PDU hostname.',
            example: 'pdu.example.org',
            required: true,
          },
        ],
      },
    ],
    documentation: [
      { id: 'configuration', title: 'Configuration', url: 'https://example.com/configuration' },
    ],
  };
}

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

