import Ajv from 'ajv';
import schema from '../../schemas/use-case.schema.json';
import { conditionPredicates, matchesCondition } from './conditions';
import type { Answers, Condition, UseCaseDefinition, ValidationResult } from './types';

const ajv = new Ajv({ allErrors: true });
const validateShape = ajv.compile(schema);

function duplicates(values: string[]): string[] {
  const seen = new Set<string>();
  const repeated = new Set<string>();
  for (const value of values) {
    if (seen.has(value)) repeated.add(value);
    seen.add(value);
  }
  return [...repeated];
}

function formatAjvError(error: NonNullable<typeof validateShape.errors>[number]): string {
  return `${error.instancePath || '/'} ${error.message ?? 'is invalid'}`;
}

function conditionErrors(
  condition: Condition | undefined,
  owner: string,
  questions: Map<string, Set<string>>,
): string[] {
  const errors: string[] = [];
  for (const predicate of conditionPredicates(condition)) {
    const options = questions.get(predicate.question);
    if (!options) {
      errors.push(`${owner} references unknown question "${predicate.question}"`);
      continue;
    }
    const values = predicate.equals ? [predicate.equals] : (predicate.in ?? []);
    for (const value of values) {
      if (!options.has(value)) {
        errors.push(`${owner} references invalid option "${value}" for "${predicate.question}"`);
      }
    }
  }
  return errors;
}

function findQuestionCycles(definition: UseCaseDefinition): string[] {
  const dependencies = new Map(
    definition.questions.map((question) => [
      question.id,
      conditionPredicates(question.visibleWhen).map((predicate) => predicate.question),
    ]),
  );
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const errors: string[] = [];

  function visit(id: string, path: string[]): void {
    if (visiting.has(id)) {
      const start = path.indexOf(id);
      errors.push(`circular question dependency: ${[...path.slice(start), id].join(' -> ')}`);
      return;
    }
    if (visited.has(id)) return;
    visiting.add(id);
    for (const dependency of dependencies.get(id) ?? []) {
      if (dependencies.has(dependency)) visit(dependency, [...path, id]);
    }
    visiting.delete(id);
    visited.add(id);
  }

  for (const id of dependencies.keys()) visit(id, []);
  return [...new Set(errors)];
}

function enumerateAnswerPaths(definition: UseCaseDefinition): Answers[] {
  let paths: Answers[] = [{}];
  for (const question of definition.questions) {
    const next: Answers[] = [];
    for (const answers of paths) {
      if (!matchesCondition(question.visibleWhen, answers)) {
        next.push(answers);
        continue;
      }
      for (const option of question.options) next.push({ ...answers, [question.id]: option.value });
    }
    paths = next;
    if (paths.length > 25_000) throw new Error('definition expands beyond 25,000 answer paths');
  }
  return paths;
}

export function validateDefinition(value: unknown): ValidationResult {
  if (!validateShape(value)) {
    return { valid: false, errors: (validateShape.errors ?? []).map(formatAjvError) };
  }

  const definition = value as unknown as UseCaseDefinition;
  const errors: string[] = [];
  const questions = new Map<string, Set<string>>();

  for (const duplicate of duplicates(definition.questions.map(({ id }) => id))) {
    errors.push(`duplicate question id "${duplicate}"`);
  }
  for (const question of definition.questions) {
    const optionValues = question.options.map(({ value: option }) => option);
    questions.set(question.id, new Set(optionValues));
    for (const duplicate of duplicates(optionValues)) {
      errors.push(`question "${question.id}" has duplicate option "${duplicate}"`);
    }
  }
  for (const question of definition.questions) {
    errors.push(...conditionErrors(question.visibleWhen, `question "${question.id}"`, questions));
  }

  const recommendationIds = definition.recommendations.map(({ id }) => id);
  for (const duplicate of duplicates(recommendationIds)) errors.push(`duplicate recommendation id "${duplicate}"`);
  const configurationIds = definition.configurations.map(({ id }) => id);
  for (const duplicate of duplicates(configurationIds)) errors.push(`duplicate configuration id "${duplicate}"`);
  const documentationIds = definition.documentation.map(({ id }) => id);
  for (const duplicate of duplicates(documentationIds)) errors.push(`duplicate documentation id "${duplicate}"`);

  const knownDocumentation = new Set(documentationIds);
  for (const recommendation of definition.recommendations) {
    errors.push(...conditionErrors(recommendation.when, `recommendation "${recommendation.id}"`, questions));
    for (const reference of recommendation.documentation) {
      if (!knownDocumentation.has(reference)) {
        errors.push(`recommendation "${recommendation.id}" references unknown documentation "${reference}"`);
      }
    }
  }
  for (const configuration of definition.configurations) {
    errors.push(...conditionErrors(configuration.when, `configuration "${configuration.id}"`, questions));
    const declared = new Set(configuration.placeholders.map(({ token }) => token));
    const used = new Set([...configuration.template.matchAll(/\{\{([A-Z][A-Z0-9_]*)\}\}/g)].map((match) => match[1]));
    const answerTokens = [...configuration.template.matchAll(/\{\{answer:([a-z][a-z0-9-]*)\}\}/g)].map((match) => match[1]);
    for (const token of declared) {
      if (!used.has(token)) errors.push(`configuration "${configuration.id}" declares unused placeholder "${token}"`);
    }
    for (const token of used) {
      if (!declared.has(token)) errors.push(`configuration "${configuration.id}" uses undeclared placeholder "${token}"`);
    }
    for (const question of answerTokens) {
      if (!questions.has(question)) errors.push(`configuration "${configuration.id}" substitutes unknown answer "${question}"`);
    }
  }

  errors.push(...findQuestionCycles(definition));
  if (!errors.length) {
    try {
      const paths = enumerateAnswerPaths(definition);
      for (const question of definition.questions) {
        if (!paths.some((answers) => answers[question.id] !== undefined)) {
          errors.push(`question "${question.id}" is unreachable`);
        }
      }
      for (const recommendation of definition.recommendations) {
        if (!paths.some((answers) => matchesCondition(recommendation.when, answers))) {
          errors.push(`recommendation "${recommendation.id}" is unreachable`);
        }
      }
      for (const configuration of definition.configurations) {
        if (!paths.some((answers) => matchesCondition(configuration.when, answers))) {
          errors.push(`configuration "${configuration.id}" is unreachable`);
        }
      }
    } catch (error) {
      errors.push(error instanceof Error ? error.message : 'could not enumerate answer paths');
    }
  }

  return { valid: errors.length === 0, errors: [...new Set(errors)] };
}
