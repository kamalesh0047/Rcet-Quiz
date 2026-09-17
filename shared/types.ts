export type GameStatus =
  | 'LOBBY'
  | 'QUESTION'
  | 'QUESTION_ENDED'
  | 'STATS'
  | 'LEADERBOARD'
  | 'ENDED';

export type ScoringMode = 'FIXED' | 'SPEED' | 'NO_BONUS';
export type AnswerIndex = 0 | 1 | 2 | 3;

export interface QuizSettings {
  scoringMode: ScoringMode;
  shuffleQuestions: boolean;
  shuffleAnswers: boolean;
  allowNegative: boolean;
  maxPlayers: number;
}

export interface Question {
  id: string;
  quizId: string;
  order: number;
  text: string;
  imageUrl?: string | null;
  options: [string, string, string, string];
  correctIndex: AnswerIndex;
  timeLimitSec: number;
  points: number;
}

/** What players receive — NEVER contains correctIndex. */
export interface PublicQuestion {
  index: number;
  total: number;
  text: string;
  imageUrl?: string | null;
  options: [string, string, string, string];
  /** option mapping when shuffleAnswers is on (display -> original) is server-only */
  timeLimitSec: number;
  points: number;
  startsAt: number;
  endsAt: number;
  serverNow: number;
}

export interface Player {
  id: string;
  nickname: string;
  score: number;
  correct: number;
  streak: number;
  connected: boolean;
}

export interface LeaderboardEntry {
  rank: number;
  playerId: string;
  nickname: string;
  score: number;
  delta: number;
  correct: number;
}

export interface AnswerStats {
  counts: [number, number, number, number];
  answered: number;
  participants: number;
  correctIndex: AnswerIndex;
}

export interface PlayerResult {
  correct: boolean;
  pointsEarned: number;
  totalScore: number;
  rank: number;
  correctIndex: AnswerIndex;
  streak: number;
}

export interface ClientToServerEvents {
  'join-game': (
    p: { pin: string; nickname: string },
    cb: (r: Ack<JoinAck>) => void,
  ) => void;
  'reconnect-player': (
    p: { pin: string; token: string },
    cb: (r: Ack<ReconnectAck>) => void,
  ) => void;
  'submit-answer': (
    p: { pin: string; questionIndex: number; answer: AnswerIndex },
    cb: (r: Ack<{ accepted: true }>) => void,
  ) => void;
  'host-join': (
    p: { pin: string; idToken: string },
    cb: (r: Ack<HostState>) => void,
  ) => void;
  'host-start-game': (p: { pin: string }, cb: (r: Ack) => void) => void;
  'host-next-question': (p: { pin: string }, cb: (r: Ack) => void) => void;
  'host-end-question': (p: { pin: string }, cb: (r: Ack) => void) => void;
  'host-show-results': (p: { pin: string }, cb: (r: Ack) => void) => void;
  'host-show-leaderboard': (p: { pin: string }, cb: (r: Ack) => void) => void;
  'host-end-game': (p: { pin: string }, cb: (r: Ack) => void) => void;
  'host-kick-player': (
    p: { pin: string; playerId: string },
    cb: (r: Ack) => void,
  ) => void;
}

export interface ServerToClientEvents {
  'player-joined': (p: {
    player: Pick<Player, 'id' | 'nickname'>;
    count: number;
  }) => void;
  'player-left': (p: { playerId: string; count: number }) => void;
  'lobby-snapshot': (p: {
    players: Pick<Player, 'id' | 'nickname'>[];
    count: number;
  }) => void;
  'game-started': (p: { totalQuestions: number }) => void;
  'question-started': (q: PublicQuestion) => void;
  'answer-count': (p: { answered: number; participants: number }) => void;
  'question-ended': (p: { questionIndex: number }) => void;
  'player-result': (r: PlayerResult) => void;
  'show-results': (s: AnswerStats) => void;
  'show-leaderboard': (p: {
    top: LeaderboardEntry[];
    you?: LeaderboardEntry;
  }) => void;
  'game-ended': (p: {
    top: LeaderboardEntry[];
    you?: LeaderboardEntry;
    resultsUrl: string;
  }) => void;
  'host-disconnected': () => void;
  'host-reconnected': () => void;
  kicked: () => void;
  'error-message': (p: { code: string; message: string }) => void;
}

export type Ack<T = unknown> =
  | { ok: true; data: T }
  | { ok: false; code: string; message: string };

export interface JoinAck {
  playerId: string;
  token: string;
  nickname: string;
  status: GameStatus;
}

export interface ReconnectAck {
  playerId: string;
  nickname: string;
  status: GameStatus;
  question?: PublicQuestion;
  alreadyAnswered: boolean;
  score: number;
  rank?: number;
}

export interface HostState {
  status: GameStatus;
  quizTitle: string;
  questionIndex: number;
  totalQuestions: number;
  participants: number;
  answered: number;
  question?: Question;
  stats?: AnswerStats;
}
