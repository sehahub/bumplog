/**
 * KV-backed JSON cache. Upstream registries are the slow part of a report, and
 * their answers for a released version never change, so almost everything here
 * is cached for a long time.
 */
export type Cache = {
  get<T>(key: string): Promise<T | null>;
  put(key: string, value: unknown, ttlSeconds: number): Promise<void>;
};

/** KV rejects TTLs below 60 seconds. */
const MIN_TTL = 60;

export function kvCache(kv: KVNamespace, waitUntil?: (p: Promise<unknown>) => void): Cache {
  return {
    async get<T>(key: string): Promise<T | null> {
      try {
        return await kv.get<T>(key, "json");
      } catch {
        // A cache that is down must not take the request down with it.
        return null;
      }
    },
    async put(key, value, ttlSeconds) {
      const write = kv
        .put(key, JSON.stringify(value), {
          expirationTtl: Math.max(MIN_TTL, Math.floor(ttlSeconds)),
        })
        .catch(() => {});
      // Don't make the reader wait on the write.
      if (waitUntil) waitUntil(write);
      else await write;
    },
  };
}

/** A cache that stores nothing, for tests and for local runs without KV. */
export function nullCache(): Cache {
  return {
    async get() {
      return null;
    },
    async put() {},
  };
}

export async function cached<T>(
  cache: Cache,
  key: string,
  ttlSeconds: number,
  load: () => Promise<T>,
): Promise<T> {
  const hit = await cache.get<T>(key);
  if (hit !== null) return hit;

  const value = await load();
  await cache.put(key, value, ttlSeconds);
  return value;
}
