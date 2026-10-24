import type { UseCaseDefinition } from '../../src/engine/types';

export function validDefinition(): UseCaseDefinition {
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

