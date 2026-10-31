import { randomUUID } from 'node:crypto';

const TTL_MS = 10 * 60 * 1000;

/** @type {Map<string, { guildId: string, userId: string, query: string, tracks: import('../music/youtube.js').Track[], expiresAt: number }>} */
const sessions = new Map();

function cleanup() {
  const now = Date.now();
  for (const [token, session] of sessions) {
    if (session.expiresAt <= now) sessions.delete(token);
  }
}

const timer = setInterval(cleanup, 60_000);
timer.unref();

/**
 * @param {{ guildId: string, userId: string, query: string, tracks: import('../music/youtube.js').Track[] }} data
 */
export function createSearchSession(data) {
  cleanup();
  const token = randomUUID().replace(/-/g, '');
  sessions.set(token, {
    ...data,
    expiresAt: Date.now() + TTL_MS,
  });
  return token;
}

/**
 * Take (and invalidate) a search session. Returns null if it expired, belongs
 * to another user, or belongs to another guild.
 *
 * @param {string} token
 * @param {{ guildId: string, userId: string }} owner
 */
export function takeSearchSession(token, owner) {
  cleanup();
  const session = sessions.get(token);
  if (!session) return null;
  if (session.guildId !== owner.guildId || session.userId !== owner.userId) return null;
  sessions.delete(token);
  return session;
}
