# QuizLive — Live Quiz Competition Platform

This project was assembled from the code supplied in the uploaded shared-chat markdown. It contains a React/Vite client, Node/Express/Socket.IO server, PostgreSQL schema, Redis-backed live game state, Firebase authentication, analytics, and result exports.

## Structure

- `client/` — student, teacher/admin, host and results UI
- `server/` — REST API, Socket.IO game engine, Redis state and PostgreSQL persistence
- `shared/` — shared TypeScript socket/game types

## Requirements

- Node.js 20+ recommended
- PostgreSQL
- Redis
- Firebase project with Authentication enabled

## Setup

1. Copy `server/.env.example` to `server/.env` and fill in PostgreSQL, Redis and Firebase Admin credentials.
2. Copy `client/.env.example` to `client/.env` and fill in the Firebase web configuration and server URL.
3. Run `npm install` from the repository root.
4. Run the database migration with `npm run migrate`.
5. Start the API with `npm run dev:server`.
6. Start Vite with `npm run dev:client`.

The client defaults to `http://localhost:5173` and the server to port `4000`.

## Important

The supplied source contains the application code, but it does not include actual Firebase credentials, PostgreSQL/Redis instances, production secrets, or the load-test/deployment files mentioned in the shared chat. Those must be configured for a real deployment.
