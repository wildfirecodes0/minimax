/**
 * In-Memory Cache
 * ---------------
 * Lightweight TTL-based cache to avoid repeated DB hits for the same data.
 * 
 * What gets cached:
 *  - User ban status      (TTL: 5 min)  — checked on EVERY interaction
 *  - Admin role           (TTL: 10 min) — checked on every admin action
 *  - Channel membership   (TTL: 3 min)  — checked on every interaction
 *
 * These are the 3 DB/API calls that fire on EVERY button press and cause
 * the 4-5 second delay. Caching them cuts response time to <500ms.
 *
 * TTLs are short enough that real changes (ban/unban, add/remove admin,
 * join/leave channel) take effect quickly without needing a bot restart.
 */

const cache = new Map(); // key -> { value, expiresAt }

/**
 * Get a cached value. Returns undefined if missing or expired.
 */
function get(key) {
  const entry = cache.get(key);
  if (!entry) return undefined;
  if (Date.now() > entry.expiresAt) {
    cache.delete(key);
    return undefined;
  }
  return entry.value;
}

/**
 * Set a value in cache with TTL in milliseconds.
 */
function set(key, value, ttlMs) {
  cache.set(key, { value, expiresAt: Date.now() + ttlMs });
}

/**
 * Manually invalidate a cache key (e.g. after ban toggle, admin change).
 */
function invalidate(key) {
  cache.delete(key);
}

/**
 * Invalidate all keys that start with a prefix.
 */
function invalidatePrefix(prefix) {
  for (const key of cache.keys()) {
    if (key.startsWith(prefix)) cache.delete(key);
  }
}

// TTL constants (milliseconds)
const TTL = {
  BAN_STATUS:        5 * 60 * 1000,  // 5 minutes
  ADMIN_ROLE:       10 * 60 * 1000,  // 10 minutes
  CHANNEL_MEMBER:    3 * 60 * 1000,  // 3 minutes
  USER_PROFILE:      2 * 60 * 1000,  // 2 minutes
};

module.exports = { get, set, invalidate, invalidatePrefix, TTL };
