import type { Server as HttpServer } from 'http';
import { Server } from 'socket.io';
import { createAdapter } from '@socket.io/redis-adapter';
import { redisPub, redisSub } from '../redis/client';
import { env } from '../config/env';
import { registerPlayerHandlers } from './playerHandlers';
import { registerHostHandlers } from './hostHandlers';
import type { ClientToServerEvents, ServerToClientEvents } from '../../../shared/types';

export interface SocketData {
  pin?: string;
  playerId?: string;
  role?: 'player' | 'host';
  hostUid?: string;
}

export function createSocketServer(http: HttpServer) {
  const io = new Server<ClientToServerEvents, ServerToClientEvents, {}, SocketData>(http, {
    cors: { origin: env.CLIENT_ORIGIN.split(','), credentials: true },
    transports: ['websocket', 'polling'],
    pingInterval: 20000,
    pingTimeout: 25000,
    maxHttpBufferSize: 16 * 1024,
    perMessageDeflate: false,
    connectionStateRecovery: { maxDisconnectionDuration: 2 * 60 * 1000 },
  });

  io.adapter(createAdapter(redisPub, redisSub));

  io.on('connection', socket => {
    registerPlayerHandlers(io, socket);
    registerHostHandlers(io, socket);
  });

  return io;
}
