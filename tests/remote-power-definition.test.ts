import { parse } from 'yaml';
import { describe, expect, it } from 'vitest';
import source from '../src/data/remote-power-control.yaml?raw';
import { DecisionEngine } from '../src/engine/decision-engine';
import { loadDefinition } from '../src/engine/load';
import type { Answers } from '../src/engine/types';

const definition = loadDefinition(source);
const engine = new DecisionEngine(definition);

describe('remote power use case', () => {
  it('loads as a valid decision definition', () => {
    expect(definition.id).toBe('remote-power-control');
    expect(definition.questions).toHaveLength(5);
  });

  it('recommends a distributed network setup for the example scenario', () => {
    const answers = {
      'power-source': 'external-adapter',
      'output-count': 'one',
      controller: 'network-pdu',
      location: 'remote-host',
      'pdu-model': 'netio',
    };
    expect(engine.recommendations(answers).map(({ recommendation }) => recommendation.id)).toEqual([
      'network-pdu-power',
      'distributed-topology',
    ]);
    expect(engine.configurations(answers).map(({ definition: config }) => config.id)).toEqual([
      'remote-network-pdu-exporter',
      'remote-network-pdu-client',
    ]);
  });

  it('does not recommend USB switching for an external adapter', () => {
    const answers = {
      'power-source': 'external-adapter',
      'output-count': 'one',
      controller: 'smart-usb-hub',
      location: 'local',
    };
    expect(engine.recommendations(answers).map(({ recommendation }) => recommendation.id)).toEqual([
      'incompatible-usb-controller',
      'local-topology',
    ]);
    expect(engine.configurations(answers)).toEqual([]);
  });

  it('requires backend verification for an unknown PDU', () => {
    const answers = {
      'power-source': 'external-adapter',
      'output-count': 'multiple',
      controller: 'network-pdu',
      location: 'remote-lab',
      'pdu-model': 'unknown',
    };
    expect(engine.recommendations(answers).map(({ recommendation }) => recommendation.id)).toEqual([
      'network-pdu-power',
      'multiple-output-guidance',
      'unknown-pdu',
      'distributed-topology',
    ]);
    expect(engine.configurations(answers)).toEqual([]);
  });

  it('generates YAML parseable templates for each supported path', () => {
    const paths: Answers[] = [
      { 'power-source': 'usb', 'output-count': 'one', controller: 'smart-usb-hub', location: 'local' },
      { 'power-source': 'usb', 'output-count': 'one', controller: 'smart-usb-hub', location: 'remote-host' },
      { 'power-source': 'usb', 'output-count': 'one', controller: 'ykush', location: 'local' },
      { 'power-source': 'usb', 'output-count': 'one', controller: 'ykush', location: 'remote-lab' },
      { 'power-source': 'external-adapter', 'output-count': 'one', controller: 'network-pdu', location: 'local', 'pdu-model': 'gude' },
      { 'power-source': 'external-adapter', 'output-count': 'one', controller: 'network-pdu', location: 'remote-lab', 'pdu-model': 'eaton' },
      { 'power-source': 'usb', 'output-count': 'one', controller: 'none', location: 'local' },
    ];
    for (const answers of paths) {
      for (const generated of engine.configurations(answers)) expect(() => parse(generated.content)).not.toThrow();
    }
  });
});
