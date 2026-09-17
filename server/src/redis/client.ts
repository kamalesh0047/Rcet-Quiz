import Redis from 'ioredis';import { env } from '../config/env';
const opts = { maxRetriesPerRequest: 3, enableAutoPipelining: true, lazyConnect: false };export const redis = new Redis(env.REDIS_URL, opts);export const redisPub = new Redis(env.REDIS_URL, opts);export const redisSub = new Redis(env.REDIS_URL, opts);
redis.on('error', e => console.error('[redis]', e.message));
