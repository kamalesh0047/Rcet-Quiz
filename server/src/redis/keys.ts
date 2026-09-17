export const k = {
  game: (pin: string) => `game:${pin}`,
  players: (pin: string) => `game:${pin}:players`,
  nicknames: (pin: string) => `game:${pin}:nicknames`,
  sockets: (pin: string) => `game:${pin}:sockets`,
  question: (pin: string) => `game:${pin}:currentQuestion`,
  timer: (pin: string) => `game:${pin}:timer`,
  answers: (pin: string, q: number) => `game:${pin}:answers:${q}`,
  answerCount: (pin: string, q: number) => `game:${pin}:answers:${q}:counts`,
  leaderboard: (pin: string) => `game:${pin}:leaderboard`,
  lastDelta: (pin: string) => `game:${pin}:lastDelta`,
  joinRate: (ip: string) => `rl:join:${ip}`,
  pinLock: (pin: string) => `lock:pin:${pin}`,
};

export const GAME_TTL_SEC = 60 * 60 * 6;
