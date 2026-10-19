import type { ReActEngineState } from './react-state.js';

type AnsweredQuestion = NonNullable<ReActEngineState['answeredUserQuestions']>[number];
type UserQuestionState = Pick<ReActEngineState, 'answeredUserQuestions'>;

export function normalizeUserQuestion(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, ' ').replace(/[.!?]+$/g, '');
}

export function hasAnsweredUserQuestion(state: UserQuestionState, question: string): boolean {
  const normalized = normalizeUserQuestion(question);
  if (!normalized) return false;
  return (state.answeredUserQuestions || []).some((item) => normalizeUserQuestion(item.question) === normalized);
}

export function recordAnsweredUserQuestion(
  state: UserQuestionState,
  question: string,
  answer: string,
  answeredAt = Date.now(),
): void {
  const normalizedQuestion = normalizeUserQuestion(question);
  const normalizedAnswer = answer.trim();
  if (!normalizedQuestion || !normalizedAnswer) return;
  const previous: AnsweredQuestion[] = state.answeredUserQuestions || [];
  state.answeredUserQuestions = [
    ...previous.filter((item) => normalizeUserQuestion(item.question) !== normalizedQuestion),
    { question: question.trim().slice(0, 4_000), answer: normalizedAnswer.slice(0, 8_000), answeredAt },
  ].slice(-8);
}
