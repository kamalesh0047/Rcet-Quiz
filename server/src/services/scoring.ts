import type { QuizSettings } from '../../../shared/types';

export function calculateScore(opts: {
  correct: boolean;
  points: number;
  responseMs: number;
  timeLimitMs: number;
  settings: QuizSettings;
  streak: number;
}): number {
  const { correct, points, responseMs, timeLimitMs, settings } = opts;
  if (!correct) return settings.allowNegative ? -Math.round(points * 0.25) : 0;

  switch (settings.scoringMode) {
    case 'FIXED':
    case 'NO_BONUS':
      return points;
    case 'SPEED': {
      const ratio = Math.min(Math.max(responseMs / timeLimitMs, 0), 1);
      const base = Math.round(points * (1 - ratio / 2));
      const streakBonus = Math.min(opts.streak, 5) * Math.round(points * 0.02);
      return base + streakBonus;
    }
    default:
      return points;
  }
}
