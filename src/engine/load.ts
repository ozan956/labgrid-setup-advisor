import { parse } from 'yaml';
import type { UseCaseDefinition } from './types';
import { validateDefinition } from './validate';

export class DefinitionError extends Error {
  constructor(public readonly errors: string[]) {
    super(`Invalid use-case definition:\n${errors.map((error) => `- ${error}`).join('\n')}`);
  }
}

export function loadDefinition(source: string): UseCaseDefinition {
  let value: unknown;
  try {
    value = parse(source);
  } catch (error) {
    throw new DefinitionError([error instanceof Error ? error.message : 'YAML parsing failed']);
  }
  const result = validateDefinition(value);
  if (!result.valid) throw new DefinitionError(result.errors);
  return value as UseCaseDefinition;
}

