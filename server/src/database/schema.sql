-- Enable UUID generation
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- =========================
-- USERS
-- =========================
CREATE TABLE IF NOT EXISTS users (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  firebase_uid  TEXT UNIQUE NOT NULL,
  email         TEXT NOT NULL,
  display_name  TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- =========================
-- QUIZZES
-- =========================
CREATE TABLE IF NOT EXISTS quizzes (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title         TEXT NOT NULL CHECK (char_length(title) BETWEEN 1 AND 120),
  description   TEXT,
  cover_url     TEXT,
  settings      JSONB NOT NULL DEFAULT
    '{"scoringMode":"SPEED","shuffleQuestions":false,"shuffleAnswers":false,"allowNegative":false,"maxPlayers":2000}'::jsonb,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS quizzes_owner_idx
  ON quizzes(owner_id);

-- =========================
-- QUESTIONS
-- =========================
CREATE TABLE IF NOT EXISTS questions (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  quiz_id        UUID NOT NULL REFERENCES quizzes(id) ON DELETE CASCADE,
  "order"        INT NOT NULL,
  text           TEXT NOT NULL CHECK (char_length(text) BETWEEN 1 AND 500),
  image_url      TEXT,
  options        JSONB NOT NULL,
  correct_index  SMALLINT NOT NULL CHECK (correct_index BETWEEN 0 AND 3),
  time_limit_sec SMALLINT NOT NULL DEFAULT 20
                 CHECK (time_limit_sec BETWEEN 5 AND 300),
  points         INT NOT NULL DEFAULT 1000
                 CHECK (points BETWEEN 0 AND 10000),
  UNIQUE (quiz_id, "order")
);

-- =========================
-- GAMES
-- =========================
CREATE TABLE IF NOT EXISTS games (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  quiz_id         UUID NOT NULL REFERENCES quizzes(id) ON DELETE CASCADE,
  host_id         UUID NOT NULL REFERENCES users(id),
  pin             CHAR(6) NOT NULL,
  status          TEXT NOT NULL DEFAULT 'LOBBY',
  quiz_snapshot   JSONB NOT NULL,
  started_at      TIMESTAMPTZ,
  ended_at        TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS games_active_pin_idx
  ON games(pin)
  WHERE status <> 'ENDED';

CREATE INDEX IF NOT EXISTS games_quiz_idx
  ON games(quiz_id);

-- =========================
-- PARTICIPANTS
-- =========================
CREATE TABLE IF NOT EXISTS participants (
  id            UUID PRIMARY KEY,
  game_id       UUID NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  nickname      TEXT NOT NULL,
  final_score   INT NOT NULL DEFAULT 0,
  final_rank    INT,
  correct_count INT NOT NULL DEFAULT 0,
  avg_response_ms INT,
  joined_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS participants_game_idx
  ON participants(game_id);

-- =========================
-- ANSWERS
-- =========================
CREATE TABLE IF NOT EXISTS answers (
  id             BIGSERIAL PRIMARY KEY,
  game_id        UUID NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  participant_id UUID NOT NULL REFERENCES participants(id) ON DELETE CASCADE,
  question_index INT NOT NULL,
  answer_index   SMALLINT,
  is_correct     BOOLEAN NOT NULL,
  response_ms    INT NOT NULL,
  points_earned  INT NOT NULL,
  UNIQUE (game_id, participant_id, question_index)
);

-- =========================
-- RESULTS
-- =========================
CREATE TABLE IF NOT EXISTS results (
  game_id            UUID PRIMARY KEY REFERENCES games(id) ON DELETE CASCADE,
  total_participants INT NOT NULL,
  average_score      NUMERIC(10,2) NOT NULL,
  question_stats     JSONB NOT NULL,
  hardest_question   INT,
  easiest_question   INT,
  computed_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);