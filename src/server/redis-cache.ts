import { createClient } from 'redis';

type RedisClient = ReturnType<typeof createClient>;

let client: RedisClient | undefined;
let lastError: string | undefined;

function getClient(): RedisClient | undefined {
  const url = process.env['REDIS_URL'];
  if (!url) {
    return undefined;
  }

  if (!client) {
    client = createClient({ url });
    client.on('error', (err: Error) => {
      if (err.message !== lastError) {
        lastError = err.message;
        console.warn('redis:', err.message);
      }
    });
    client.on('ready', () => {
      lastError = undefined;
      console.log('redis: connected');
    });
    client.connect().catch(() => {});
  }

  return client;
}

export async function cacheGet(key: string): Promise<string | undefined> {
  const redis = getClient();
  if (!redis?.isReady) {
    return undefined;
  }

  try {
    return (await redis.get(key)) ?? undefined;
  } catch (err) {
    console.warn('redis get:', (err as Error).message);
    return undefined;
  }
}

export async function cacheSet(key: string, ttlSeconds: number, value: string): Promise<void> {
  const redis = getClient();
  if (!redis?.isReady) {
    return;
  }

  try {
    await redis.set(key, value, { expiration: { type: 'EX', value: ttlSeconds } });
  } catch (err) {
    console.warn('redis set:', (err as Error).message);
  }
}
