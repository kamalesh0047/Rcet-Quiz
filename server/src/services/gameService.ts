import { randomUUID } from 'crypto';
import type { Server } from 'socket.io';
import { GameState } from '../redis/gameState';
import { redis } from '../redis/client';
import { k } from '../redis/keys';
import { calculateScore } from './scoring';
import { pool } from '../database/pool';
import { generateUniquePin } from '../utils/pin';
import { signPlayerToken } from '../utils/playerToken';
import type {
  Question,
  QuizSettings,
  Player,
  PublicQuestion,
  LeaderboardEntry,
  AnswerStats,
  AnswerIndex,
  ClientToServerEvents,
  ServerToClientEvents,
} from '../../../shared/types';

type IO = Server<ClientToServerEvents, ServerToClientEvents>;
const QUESTION_GRACE_MS = 750;

export class GameError extends Error {
  constructor(public code: string, message: string) {
    super(message);
  }
}

const shuffle = <T,>(a: T[]) => {
  const b = [...a];
  for (let i = b.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [b[i], b[j]] = [b[j], b[i]];
  }
  return b;
};

export const GameService = {
  async createGame(quizId: string, hostId: string) {
    const { rows: [quiz] } = await pool.query(
      `SELECT q.*, u.id AS owner
       FROM quizzes q
       JOIN users u ON u.id=q.owner_id
       WHERE q.id=$1 AND q.owner_id=$2`,
      [quizId, hostId],
    );
    if (!quiz) throw new GameError('NOT_FOUND', 'Quiz not found');

    const { rows: qs } = await pool.query(
      `SELECT * FROM questions WHERE quiz_id=$1 ORDER BY "order"`,
      [quizId],
    );
    if (!qs.length) throw new GameError('EMPTY_QUIZ', 'Quiz has no questions');

    const settings: QuizSettings = quiz.settings;
    let questions: Question[] = qs.map((r, i) => ({
      id: r.id,
      quizId,
      order: i,
      text: r.text,
      imageUrl: r.image_url,
      options: r.options,
      correctIndex: r.correct_index,
      timeLimitSec: r.time_limit_sec,
      points: r.points,
    }));

    if (settings.shuffleQuestions) questions = shuffle(questions);
    if (settings.shuffleAnswers) {
      questions = questions.map(q => {
        const idx = shuffle([0, 1, 2, 3]);
        return {
          ...q,
          options: idx.map(i => q.options[i]) as Question['options'],
          correctIndex: idx.indexOf(q.correctIndex) as AnswerIndex,
        };
      });
    }

    const pin = await generateUniquePin();
    const snapshot = { title: quiz.title, settings, questions };
    const { rows: [game] } = await pool.query(
      `INSERT INTO games (quiz_id, host_id, pin, quiz_snapshot)
       VALUES ($1,$2,$3,$4) RETURNING id`,
      [quizId, hostId, pin, snapshot],
    );

    await GameState.create(pin, {
      gameId: game.id,
      quizId,
      hostId,
      title: quiz.title,
      status: 'LOBBY',
      questionIndex: -1,
      totalQuestions: questions.length,
      settings: JSON.stringify(settings),
    });

    await redis.set(`${k.game(pin)}:questions`, JSON.stringify(questions), 'EX', 60 * 60 * 6);
    return { pin, gameId: game.id, title: quiz.title, totalQuestions: questions.length };
  },

  async questions(pin: string): Promise<Question[]> {
    return JSON.parse((await redis.get(`${k.game(pin)}:questions`)) ?? '[]') as Question[];
  },

  async join(pin: string, nickname: string, socketId: string) {
    const meta = await GameState.meta(pin);
    if (!meta) throw new GameError('INVALID_PIN', 'That game PIN doesn’t exist');
    if (meta.status !== 'LOBBY') throw new GameError('GAME_LOCKED', 'This game has already started');
    const settings: QuizSettings = JSON.parse(meta.settings);
    if ((await GameState.playerCount(pin)) >= settings.maxPlayers) {
      throw new GameError('GAME_FULL', 'This game is full');
    }
    if (!(await GameState.reserveNickname(pin, nickname))) {
      throw new GameError('NICKNAME_TAKEN', 'That nickname is already taken');
    }

    const player: Player = {
      id: randomUUID(),
      nickname,
      score: 0,
      correct: 0,
      streak: 0,
      connected: true,
    };
    await GameState.addPlayer(pin, player, socketId);
    await pool
      .query(
        `INSERT INTO participants (id, game_id, nickname) VALUES ($1,$2,$3)`,
        [player.id, meta.gameId, nickname],
      )
      .catch(e => console.error('[participants insert]', e instanceof Error ? e.message : e));

    return {
      player,
      token: signPlayerToken({ pin, playerId: player.id }),
      status: meta.status,
    };
  },

  async startGame(io: IO, pin: string) {
    const meta = await this.requireMeta(pin);
    if (meta.status !== 'LOBBY') throw new GameError('BAD_STATE', 'Game already started');
    await pool.query(
      `UPDATE games SET status='QUESTION', started_at=now() WHERE id=$1`,
      [meta.gameId],
    );
    io.to(pin).emit('game-started', { totalQuestions: meta.totalQuestions });
    setTimeout(() => this.nextQuestion(io, pin).catch(console.error), 3000);
  },

  async nextQuestion(io: IO, pin: string) {
    const meta = await this.requireMeta(pin);
    const nextIndex = meta.questionIndex + 1;
    const questions = await this.questions(pin);
    if (nextIndex >= questions.length) return this.endGame(io, pin);

    const q = questions[nextIndex];
    const startsAt = Date.now() + 500;
    const endsAt = startsAt + q.timeLimitSec * 1000;
    await GameState.startQuestion(pin, nextIndex, q, startsAt, endsAt);

    const publicQ: PublicQuestion = {
      index: nextIndex,
      total: questions.length,
      text: q.text,
      imageUrl: q.imageUrl,
      options: q.options,
      timeLimitSec: q.timeLimitSec,
      points: q.points,
      startsAt,
      endsAt,
      serverNow: Date.now(),
    };
    io.to(pin).emit('question-started', publicQ);
    io.to(`${pin}:host`).emit('question-started', publicQ);

    setTimeout(
      () => this.endQuestion(io, pin, nextIndex).catch(console.error),
      Math.max(0, endsAt - Date.now() + QUESTION_GRACE_MS),
    );
  },

  async submitAnswer(
    io: IO,
    pin: string,
    playerId: string,
    questionIndex: number,
    answer: AnswerIndex,
  ) {
    const now = Date.now();
    const code = await GameState.submitAnswer(
      pin,
      questionIndex,
      playerId,
      answer,
      now,
      { answer, at: now },
    );

    if (code === -1) throw new GameError('DUPLICATE_ANSWER', 'You already answered this question');
    if (code === -2) throw new GameError('TOO_LATE', 'Time’s up for this question');
    if (code === -3) throw new GameError('BAD_STATE', 'This question is no longer active');

    const flag = await redis.set(`${k.game(pin)}:countThrottle`, '1', 'PX', 150, 'NX');
    if (flag) {
      const [answered, participants] = await Promise.all([
        GameState.answeredCount(pin, questionIndex),
        GameState.playerCount(pin),
      ]);
      io.to(`${pin}:host`).emit('answer-count', { answered, participants });
    }

    const [answered, participants] = await Promise.all([
      GameState.answeredCount(pin, questionIndex),
      GameState.playerCount(pin),
    ]);
    if (answered >= participants) {
      this.endQuestion(io, pin, questionIndex).catch(console.error);
    }
  },

  async endQuestion(io: IO, pin: string, questionIndex: number) {
    const lock = await redis.set(
      `${k.game(pin)}:endlock:${questionIndex}`,
      '1',
      'EX',
      30,
      'NX',
    );
    if (!lock) return;

    const meta = await this.requireMeta(pin);
    if (meta.status !== 'QUESTION' || meta.questionIndex !== questionIndex) return;
    await GameState.setStatus(pin, 'QUESTION_ENDED');

    const [q, timer, answers, players] = await Promise.all([
      GameState.currentQuestion(pin),
      GameState.timer(pin),
      GameState.allAnswers(pin, questionIndex),
      GameState.allPlayers(pin),
    ]);
    if (!q) return;

    const settings: QuizSettings = JSON.parse(meta.settings);
    const timeLimitMs = q.timeLimitSec * 1000;
    const updates: { player: Player; delta: number }[] = [];
    const dbRows: unknown[][] = [];

    for (const p of players) {
      const a = answers[p.id];
      const correct = !!a && a.answer === q.correctIndex;
      const responseMs = a ? Math.max(0, a.at - timer.startsAt) : timeLimitMs;
      p.streak = correct ? p.streak + 1 : 0;
      const delta = a
        ? calculateScore({
            correct,
            points: q.points,
            responseMs,
            timeLimitMs,
            settings,
            streak: p.streak,
          })
        : 0;
      p.score = Math.max(settings.allowNegative ? -Infinity : 0, p.score + delta);
      if (correct) p.correct += 1;
      updates.push({ player: p, delta });
      dbRows.push([
        meta.gameId,
        p.id,
        questionIndex,
        a?.answer ?? null,
        correct,
        responseMs,
        delta,
      ]);
    }

    await GameState.applyScores(pin, updates);

    if (dbRows.length) {
      const values = dbRows
        .map(
          (_, i) =>
            `($${i * 7 + 1},$${i * 7 + 2},$${i * 7 + 3},$${i * 7 + 4},$${i * 7 + 5},$${i * 7 + 6},$${i * 7 + 7})`,
        )
        .join(',');
      pool
        .query(
          `INSERT INTO answers
            (game_id,participant_id,question_index,answer_index,is_correct,response_ms,points_earned)
           VALUES ${values} ON CONFLICT DO NOTHING`,
          dbRows.flat(),
        )
        .catch(e => console.error('[answers insert]', e instanceof Error ? e.message : e));
    }

    io.to(pin).emit('question-ended', { questionIndex });
    io.to(`${pin}:host`).emit('question-ended', { questionIndex });

    const sockets = await redis.hgetall(k.sockets(pin));
    await Promise.all(
      updates.map(async ({ player, delta }) => {
        const sid = sockets[player.id];
        if (!sid) return;
        const rank = (await GameState.rankOf(pin, player.id)) ?? 0;
        io.to(sid).emit('player-result', {
          correct: answers[player.id]?.answer === q.correctIndex,
          pointsEarned: delta,
          totalScore: player.score,
          rank,
          correctIndex: q.correctIndex,
          streak: player.streak,
        });
      }),
    );
  },

  async showResults(io: IO, pin: string) {
    const meta = await this.requireMeta(pin);
    const q = await GameState.currentQuestion(pin);
    if (!q || !['QUESTION_ENDED', 'LEADERBOARD'].includes(meta.status)) {
      throw new GameError('BAD_STATE', 'No results to show yet');
    }

    const [counts, answered, participants] = await Promise.all([
      GameState.answerCounts(pin, meta.questionIndex),
      GameState.answeredCount(pin, meta.questionIndex),
      GameState.playerCount(pin),
    ]);
    const stats: AnswerStats = {
      counts,
      answered,
      participants,
      correctIndex: q.correctIndex,
    };
    await GameState.setStatus(pin, 'STATS');
    io.to(pin).emit('show-results', stats);
    io.to(`${pin}:host`).emit('show-results', stats);
  },

  async buildLeaderboard(pin: string, limit = 10): Promise<LeaderboardEntry[]> {
    const top = await GameState.leaderboard(pin, limit);
    return Promise.all(
      top.map(async (t, i) => {
        const [p, delta] = await Promise.all([
          GameState.player(pin, t.playerId),
          GameState.lastDelta(pin, t.playerId),
        ]);
        return {
          rank: i + 1,
          playerId: t.playerId,
          nickname: p?.nickname ?? '?',
          score: t.score,
          delta,
          correct: p?.correct ?? 0,
        };
      }),
    );
  },

  async entryFor(pin: string, playerId: string): Promise<LeaderboardEntry | undefined> {
    const [p, rank, delta] = await Promise.all([
      GameState.player(pin, playerId),
      GameState.rankOf(pin, playerId),
      GameState.lastDelta(pin, playerId),
    ]);
    if (!p || rank === null) return;
    return {
      rank,
      playerId,
      nickname: p.nickname,
      score: p.score,
      delta,
      correct: p.correct,
    };
  },

  async showLeaderboard(io: IO, pin: string) {
    await GameState.setStatus(pin, 'LEADERBOARD');
    const top = await this.buildLeaderboard(pin, 10);
    io.to(`${pin}:host`).emit('show-leaderboard', { top });

    const sockets = await redis.hgetall(k.sockets(pin));
    const top5 = top.slice(0, 5);
    await Promise.all(
      Object.entries(sockets).map(async ([playerId, sid]) => {
        io.to(sid).emit('show-leaderboard', {
          top: top5,
          you: await this.entryFor(pin, playerId),
        });
      }),
    );
  },

  async endGame(io: IO, pin: string) {
    const meta = await this.requireMeta(pin);
    await GameState.setStatus(pin, 'ENDED');
    const top = await this.buildLeaderboard(pin, 10);
    const all = await GameState.allPlayers(pin);
    const resultsUrl = `/results/${pin}`;

    const ranked = [...all].sort((a, b) => b.score - a.score);
    await pool.query('BEGIN');
    try {
      for (let i = 0; i < ranked.length; i++) {
        await pool.query(
          `UPDATE participants
           SET final_score=$1,
               final_rank=$2,
               correct_count=$3,
               avg_response_ms=(SELECT AVG(response_ms)::int FROM answers
                                WHERE participant_id=$4 AND answer_index IS NOT NULL)
           WHERE id=$4`,
          [ranked[i].score, i + 1, ranked[i].correct, ranked[i].id],
        );
      }
      await pool.query(`UPDATE games SET status='ENDED', ended_at=now() WHERE id=$1`, [meta.gameId]);
      await pool.query('COMMIT');
    } catch (e) {
      await pool.query('ROLLBACK');
      console.error('[endGame persist]', e);
    }

    const { AnalyticsService } = await import('./analyticsService');
    AnalyticsService.compute(meta.gameId).catch(console.error);

    io.to(`${pin}:host`).emit('game-ended', { top, resultsUrl });
    const sockets = await redis.hgetall(k.sockets(pin));
    await Promise.all(
      Object.entries(sockets).map(async ([playerId, sid]) => {
        io.to(sid).emit('game-ended', {
          top: top.slice(0, 3),
          you: await this.entryFor(pin, playerId),
          resultsUrl,
        });
      }),
    );

    setTimeout(
      () => GameState.destroy(pin, meta.totalQuestions).catch(console.error),
      5 * 60 * 1000,
    );
  },

  async reconnect(pin: string, playerId: string, socketId: string) {
    const meta = await this.requireMeta(pin);
    const player = await GameState.player(pin, playerId);
    if (!player) throw new GameError('EXPIRED_SESSION', 'Your session has expired');

    await GameState.setConnected(pin, playerId, socketId);
    let question: PublicQuestion | undefined;
    let alreadyAnswered = false;

    if (meta.status === 'QUESTION') {
      const [q, t] = await Promise.all([
        GameState.currentQuestion(pin),
        GameState.timer(pin),
      ]);
      if (q) {
        question = {
          index: meta.questionIndex,
          total: meta.totalQuestions,
          text: q.text,
          imageUrl: q.imageUrl,
          options: q.options,
          timeLimitSec: q.timeLimitSec,
          points: q.points,
          startsAt: t.startsAt,
          endsAt: t.endsAt,
          serverNow: Date.now(),
        };
        alreadyAnswered = await GameState.hasAnswered(pin, meta.questionIndex, playerId);
      }
    }

    return {
      player,
      status: meta.status,
      question,
      alreadyAnswered,
      rank: (await GameState.rankOf(pin, playerId)) ?? undefined,
    };
  },

  async requireMeta(pin: string) {
    const meta = await GameState.meta(pin);
    if (!meta) throw new GameError('INVALID_PIN', 'Game not found');
    return meta;
  },
};
