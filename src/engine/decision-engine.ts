import { conditionPredicates, matchesCondition, matchesPredicate } from './conditions';
import type {
  Answers,
  ConfigurationTemplate,
  Question,
  Recommendation,
  UseCaseDefinition,
} from './types';

export interface AnswerIssue {
  question: string;
  message: string;
}

export interface AnswerStatus {
  complete: boolean;
  missing: Question[];
  inconsistent: AnswerIssue[];
}

export interface RecommendationMatch {
  recommendation: Recommendation;
  matchedAnswers: string[];
}

/** User- or profile-supplied values for declared placeholder tokens, keyed by token. */
export type PlaceholderValues = Record<string, string>;

export interface GeneratedConfiguration {
  definition: ConfigurationTemplate;
  content: string;
  unresolved: ConfigurationTemplate['placeholders'];
  ready: boolean;
  /** Placeholder values that were substituted into the content. */
  applied: PlaceholderValues;
}

const SAFE_BARE_SCALAR = /^[A-Za-z0-9][A-Za-z0-9_./:@-]*$/;

function singleQuoted(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

function doubleQuoted(value: string): string {
  return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

/** A bare YAML scalar is only safe for plain identifiers and numbers; everything else is quoted. */
function bareScalar(value: string): string {
  if (/^-?\d+(\.\d+)?$/.test(value)) return value;
  if (SAFE_BARE_SCALAR.test(value) && !/^(true|false|null|yes|no|on|off|~)$/i.test(value)) return value;
  return singleQuoted(value);
}

export class DecisionEngine {
  constructor(public readonly definition: UseCaseDefinition) {}

  visibleQuestions(answers: Answers): Question[] {
    return this.definition.questions.filter((question) => matchesCondition(question.visibleWhen, answers));
  }

  nextQuestion(answers: Answers): Question | undefined {
    return this.visibleQuestions(answers).find((question) => answers[question.id] === undefined);
  }

  answerStatus(answers: Answers): AnswerStatus {
    const inconsistent: AnswerIssue[] = [];
    const knownQuestions = new Map(this.definition.questions.map((question) => [question.id, question]));
    const visible = new Set(this.visibleQuestions(answers).map(({ id }) => id));

    for (const [questionId, answer] of Object.entries(answers)) {
      const question = knownQuestions.get(questionId);
      if (!question) {
        inconsistent.push({ question: questionId, message: 'Unknown question.' });
      } else if (!visible.has(questionId)) {
        inconsistent.push({ question: questionId, message: 'This question is not relevant to the current path.' });
      } else if (!question.options.some(({ value }) => value === answer)) {
        inconsistent.push({ question: questionId, message: `Unknown option "${answer}".` });
      }
    }

    const missing = this.visibleQuestions(answers).filter((question) => answers[question.id] === undefined);
    return { complete: missing.length === 0 && inconsistent.length === 0, missing, inconsistent };
  }

  setAnswer(answers: Answers, questionId: string, value: string): Answers {
    const question = this.definition.questions.find(({ id }) => id === questionId);
    if (!question) throw new Error(`Unknown question "${questionId}"`);
    if (!matchesCondition(question.visibleWhen, answers)) throw new Error(`Question "${questionId}" is not visible`);
    if (!question.options.some((option) => option.value === value)) {
      throw new Error(`Invalid option "${value}" for question "${questionId}"`);
    }

    const reconciled = { ...answers, [questionId]: value };
    let changed = true;
    while (changed) {
      changed = false;
      for (const candidate of this.definition.questions) {
        const answer = reconciled[candidate.id];
        if (answer === undefined) continue;
        const valid = candidate.options.some((option) => option.value === answer);
        if (!valid || !matchesCondition(candidate.visibleWhen, reconciled)) {
          delete reconciled[candidate.id];
          changed = true;
        }
      }
    }
    return reconciled;
  }

  recommendations(answers: Answers): RecommendationMatch[] {
    if (!this.answerStatus(answers).complete) return [];
    return this.definition.recommendations
      .filter((recommendation) => matchesCondition(recommendation.when, answers))
      .map((recommendation) => ({
        recommendation,
        matchedAnswers: this.describeMatches(recommendation, answers),
      }));
  }

  configurations(answers: Answers, values: PlaceholderValues = {}): GeneratedConfiguration[] {
    if (!this.answerStatus(answers).complete) return [];
    return this.definition.configurations
      .filter((configuration) => matchesCondition(configuration.when, answers))
      .map((configuration) => this.renderConfiguration(configuration, answers, values));
  }

  /** Every placeholder declared by the configurations selected for these answers, deduplicated by token. */
  placeholders(answers: Answers): ConfigurationTemplate['placeholders'] {
    const seen = new Map<string, ConfigurationTemplate['placeholders'][number]>();
    for (const configuration of this.configurations(answers)) {
      for (const placeholder of configuration.definition.placeholders) {
        if (!seen.has(placeholder.token)) seen.set(placeholder.token, placeholder);
      }
    }
    return [...seen.values()];
  }

  private describeMatches(recommendation: Recommendation, answers: Answers): string[] {
    const descriptions = conditionPredicates(recommendation.when)
      .filter((predicate) => matchesPredicate(predicate, answers))
      .map((predicate) => {
        const question = this.definition.questions.find(({ id }) => id === predicate.question);
        const option = question?.options.find(({ value }) => value === answers[predicate.question]);
        return question && option ? `${question.text} ${option.label}` : undefined;
      })
      .filter((description): description is string => description !== undefined);
    return [...new Set(descriptions)];
  }

  private renderConfiguration(
    configuration: ConfigurationTemplate,
    answers: Answers,
    values: PlaceholderValues,
  ): GeneratedConfiguration {
    const declared = new Set(configuration.placeholders.map(({ token }) => token));
    const applied: PlaceholderValues = {};
    // Whitespace is significant in prompt expressions such as ' login: ', so only
    // blank values are treated as missing and the original text is substituted.
    const valueFor = (token: string): string | undefined => {
      if (!declared.has(token)) return undefined;
      const value = values[token];
      if (value === undefined || value.trim().length === 0) return undefined;
      applied[token] = value;
      return value;
    };

    const content = configuration.template
      .replace(/\{\{answer:([a-z][a-z0-9-]*)\}\}/g, (_, question: string) => answers[question] ?? `<${question.toUpperCase()}>`)
      .replace(/'\{\{([A-Z][A-Z0-9_]*)\}\}'/g, (_, token: string) => {
        const value = valueFor(token);
        return value === undefined ? `'<${token}>'` : singleQuoted(value);
      })
      .replace(/"\{\{([A-Z][A-Z0-9_]*)\}\}"/g, (_, token: string) => {
        const value = valueFor(token);
        return value === undefined ? `"<${token}>"` : doubleQuoted(value);
      })
      .replace(/\{\{([A-Z][A-Z0-9_]*)\}\}/g, (_, token: string) => {
        const value = valueFor(token);
        return value === undefined ? `<${token}>` : bareScalar(value);
      });
    const unresolved = configuration.placeholders.filter(({ token, required }) => required && applied[token] === undefined);
    return { definition: configuration, content, unresolved, ready: unresolved.length === 0, applied };
  }
}

