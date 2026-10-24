import type { Answers, Condition, Predicate } from './types';

export function matchesPredicate(predicate: Predicate, answers: Answers): boolean {
  const answer = answers[predicate.question];
  if (answer === undefined) return false;
  if (predicate.equals !== undefined) return answer === predicate.equals;
  return predicate.in?.includes(answer) ?? false;
}

export function matchesCondition(condition: Condition | undefined, answers: Answers): boolean {
  if (!condition) return true;
  const allMatch = condition.all?.every((predicate) => matchesPredicate(predicate, answers)) ?? true;
  const anyMatch = condition.any?.some((predicate) => matchesPredicate(predicate, answers)) ?? true;
  return allMatch && anyMatch;
}

export function conditionPredicates(condition: Condition | undefined): Predicate[] {
  return [...(condition?.all ?? []), ...(condition?.any ?? [])];
}

