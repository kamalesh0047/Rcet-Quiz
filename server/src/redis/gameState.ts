import { redis } from './client';
import { k, GAME_TTL_SEC } from './keys';
import type { GameStatus, Player, Question } from '../../../shared/types';

const SUBMIT_LUA = `
local status = redis.call('HGET', KEYS[4], 'status')
local qi = redis.call('HGET', KEYS[4], 'questionIndex')
if status ~= 'QUESTION' or qi ~= ARGV[4] then return -3 end
local endsAt = tonumber(redis.call('HGET', KEYS[3], 'endsAt') or '0')
if tonumber(ARGV[3]) > endsAt then return -2 end
if redis.call('HEXISTS', KEYS[1], ARGV[1]) == 1 then return -1 end
redis.call('HSET', KEYS[1], ARGV[1], ARGV[5])
redis.call('HINCRBY', KEYS[2], ARGV[2], 1)
return 1
`;

redis.defineCommand('submitAnswer', { numberOfKeys: 4, lua: SUBMIT_LUA });

declare module 'ioredis' {
  interface RedisCommander<Context> {
    submitAnswer(
      a: string,
      b: string,
      c: string,
      d: string,
      playerId: string,
      answerIdx: string,
      now: string,
      qi: string,
      payload: string,
    ): Promise<number>;
  }
}

export interface GameMeta {
  gameId: string;
  quizId: string;
  hostId: string;
  title: string;
  status: GameStatus;
  questionIndex: number;
  totalQuestions: number;
  hostSocketId?: string;
  settings: string;
}

export const GameState = {
  async create(pin: string, meta: GameMeta) {
    const m = redis.multi();
    m.hset(k.game(pin), { ...meta, questionIndex: -1 });
    for (const key of [
      k.game(pin),
      k.players(pin),
      k.nicknames(pin),
      k.sockets(pin),
      k.leaderboard(pin),
    ]) {
      m.expire(key, GAME_TTL_SEC);
    }
    await m.exec();
  },

  async meta(pin: string): Promise<GameMeta | null> {
    const h = await redis.hgetall(k.game(pin));
    if (!h.gameId) return null;
    return {
      gameId: h.gameId,
      quizId: h.quizId,
      hostId: h.hostId,
      title: h.title,
      status: h.status as GameStatus,
      questionIndex: Number(h.questionIndex),
      totalQuestions: Number(h.totalQuestions),
      hostSocketId: h.hostSocketId,
      settings: h.settings,
    };
  },

  setStatus: (pin: string, status: GameStatus) => redis.hset(k.game(pin), 'status', status),
  setHostSocket: (pin: string, sid: string) => redis.hset(k.game(pin), 'hostSocketId', sid),

  async reserveNickname(pin: string, nick: string) {
    return (await redis.sadd(k.nicknames(pin), nick.toLowerCase())) === 1;
  },

  async addPlayer(pin: string, p: Player, socketId: string) {
    await redis
      .multi()
      .hset(k.players(pin), p.id, JSON.stringify(p))
      .hset(k.sockets(pin), p.id, socketId)
      .zadd(k.leaderboard(pin), 0, p.id)
      .exec();
  },

  async player(pin: string, id: string): Promise<Player | null> {
    const raw = await redis.hget(k.players(pin), id);
    return raw ? (JSON.parse(raw) as Player) : null;
  },

  async allPlayers(pin: string): Promise<Player[]> {
    const h = await redis.hvals(k.players(pin));
    return h.map(v => JSON.parse(v) as Player);
  },

  playerCount: (pin: string) => redis.hlen(k.players(pin)),

  async setConnected(pin: string, id: string, socketId: string | null) {
    const p = await GameState.player(pin, id);
    if (!p) return;
    p.connected = !!socketId;
    const m = redis.multi().hset(k.players(pin), id, JSON.stringify(p));
    if (socketId) m.hset(k.sockets(pin), id, socketId);
    else m.hdel(k.sockets(pin), id);
    await m.exec();
  },

  async removePlayer(pin: string, id: string) {
    const p = await GameState.player(pin, id);
    await redis
      .multi()
      .hdel(k.players(pin), id)
      .hdel(k.sockets(pin), id)
      .zrem(k.leaderboard(pin), id)
      .srem(k.nicknames(pin), (p?.nickname ?? '').toLowerCase())
      .exec();
  },

  async startQuestion(pin: string, index: number, q: Question, startsAt: number, endsAt: number) {
    await redis
      .multi()
      .set(k.question(pin), JSON.stringify(q), 'EX', GAME_TTL_SEC)
      .hset(k.timer(pin), { startsAt, endsAt })
      .hset(k.game(pin), { status: 'QUESTION', questionIndex: index })
      .del(k.answers(pin, index), k.answerCount(pin, index), k.lastDelta(pin))
      .hset(k.answerCount(pin, index), { 0: 0, 1: 0, 2: 0, 3: 0 })
      .expire(k.answers(pin, index), GAME_TTL_SEC)
      .expire(k.answerCount(pin, index), GAME_TTL_SEC)
      .exec();
  },

  async currentQuestion(pin: string): Promise<Question | null> {
    const raw = await redis.get(k.question(pin));
    return raw ? (JSON.parse(raw) as Question) : null;
  },

  async timer(pin: string) {
    const t = await redis.hgetall(k.timer(pin));
    return { startsAt: Number(t.startsAt), endsAt: Number(t.endsAt) };
  },

  submitAnswer(pin: string, qi: number, playerId: string, answer: number, now: number, payload: object) {
    return redis.submitAnswer(
      k.answers(pin, qi),
      k.answerCount(pin, qi),
      k.timer(pin),
      k.game(pin),
      playerId,
      String(answer),
      String(now),
      String(qi),
      JSON.stringify(payload),
    );
  },

  async hasAnswered(pin: string, qi: number, playerId: string) {
    return (await redis.hexists(k.answers(pin, qi), playerId)) === 1;
  },

  answeredCount: (pin: string, qi: number) => redis.hlen(k.answers(pin, qi)),

  async answerCounts(pin: string, qi: number): Promise<[number, number, number, number]> {
    const c = await redis.hmget(k.answerCount(pin, qi), '0', '1', '2', '3');
    return c.map(x => Number(x ?? 0)) as [number, number, number, number];
  },

  async allAnswers(pin: string, qi: number): Promise<Record<string, { answer: number; at: number }>> {
    const h = await redis.hgetall(k.answers(pin, qi));
    return Object.fromEntries(
      Object.entries(h).map(([id, v]) => [id, JSON.parse(v) as { answer: number; at: number }]),
    );
  },

  async applyScores(pin: string, updates: { player: Player; delta: number }[]) {
    const m = redis.multi();
    for (const { player, delta } of updates) {
      m.hset(k.players(pin), player.id, JSON.stringify(player));
      m.hset(k.lastDelta(pin), player.id, delta);
      if (delta !== 0) m.zincrby(k.leaderboard(pin), delta, player.id);
    }
    await m.exec();
  },

  async leaderboard(pin: string, limit = 10) {
    const rows = await redis.zrevrange(k.leaderboard(pin), 0, limit - 1, 'WITHSCORES');
    const out: { playerId: string; score: number }[] = [];
    for (let i = 0; i < rows.length; i += 2) {
      out.push({ playerId: rows[i], score: Number(rows[i + 1]) });
    }
    return out;
  },

  async rankOf(pin: string, playerId: string) {
    const r = await redis.zrevrank(k.leaderboard(pin), playerId);
    return r === null ? null : r + 1;
  },

  lastDelta: async (pin: string, id: string) => Number((await redis.hget(k.lastDelta(pin), id)) ?? 0),

  async destroy(pin: string, totalQuestions: number) {
    const keys = [
      k.game(pin),
      k.players(pin),
      k.nicknames(pin),
      k.sockets(pin),
      k.question(pin),
      k.timer(pin),
      k.leaderboard(pin),
      k.lastDelta(pin),
    ];
    for (let i = 0; i < totalQuestions; i++) {
      keys.push(k.answers(pin, i), k.answerCount(pin, i));
    }
    await redis.del(...keys);
  },
};
