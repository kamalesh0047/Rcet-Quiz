import { io, type Socket } from 'socket.io-client';
import type {
  Ack,
  ClientToServerEvents,
  ServerToClientEvents,
} from '@shared/types';

export type AppSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

let socket: AppSocket | null = null;

export function getSocket(): AppSocket {
  if (!socket) {
    socket = io(import.meta.env.VITE_SERVER_URL, {
      transports: ['websocket', 'polling'],
      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelay: 500,
      reconnectionDelayMax: 4000,
      randomizationFactor: 0.5,
    });
  }
  return socket;
}

/** Emit with ack + timeout, always resolves to an Ack. */
export function emitAck<K extends keyof ClientToServerEvents>(
  event: K,
  payload: Parameters<ClientToServerEvents[K]>[0],
): Promise<Ack<any>> {
  return new Promise((resolve) => {
    (getSocket() as any)
      .timeout(8000)
      .emit(
        event,
        payload,
        (err: unknown, ack: Ack<any>) =>
          resolve(
            err
              ? {
                  ok: false,
                  code: 'TIMEOUT',
                  message: 'Server not responding — retrying…',
                }
              : ack,
          ),
      );
  });
}
