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

export interface GeneratedConfiguration {
  definition: ConfigurationTemplate;
  content: string;
  unresolved: ConfigurationTemplate['placeholders'];
  ready: boolean;
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

  configurations(answers: Answers): GeneratedConfiguration[] {
    if (!this.answerStatus(answers).complete) return [];
    return this.definition.configurations
      .filter((configuration) => matchesCondition(configuration.when, answers))
      .map((configuration) => this.renderConfiguration(configuration, answers));
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

  private renderConfiguration(configuration: ConfigurationTemplate, answers: Answers): GeneratedConfiguration {
    const content = configuration.template
      .replace(/\{\{answer:([a-z][a-z0-9-]*)\}\}/g, (_, question: string) => answers[question] ?? `<${question.toUpperCase()}>`)
      .replace(/\{\{([A-Z][A-Z0-9_]*)\}\}/g, '<$1>');
    const unresolved = configuration.placeholders.filter(({ required }) => required);
    return { definition: configuration, content, unresolved, ready: unresolved.length === 0 };
  }
}

