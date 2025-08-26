
import { query, run } from '../db/db.js';

export async function consumeLimit(key, limit, windowSeconds) {
  const now = new Date();
  const rows = await query('select key, count, reset_at from rate_limits where key=$1', [key]);
  if (rows.length === 0) {
    const resetAt = new Date(Date.now() + windowSeconds * 1000).toISOString();
    run('insert into rate_limits (key, count, reset_at) values ($1,$2,$3)', [key, 1, resetAt]);
    return { ok: true, remaining: limit - 1, resetAt };
  }
  const rl = rows[0];
  if (new Date(rl.reset_at) <= now) {
    const resetAt = new Date(Date.now() + windowSeconds * 1000).toISOString();
    run('update rate_limits set count=1, reset_at=$2 where key=$1', [key, resetAt]);
    return { ok: true, remaining: limit - 1, resetAt };
  }
  if (rl.count >= limit) {
    return { ok: false, remaining: 0, resetAt: rl.reset_at };
  }
  run('update rate_limits set count=count+1 where key=$1', [key]);
  return { ok: true, remaining: limit - (rl.count + 1), resetAt: rl.reset_at };
}

export async function remainingToday(key, dailyLimit) {
  const resetKey = key + ':' + new Date().toISOString().slice(0,10);
  const r = await consumeLimit(resetKey, dailyLimit, 24*60*60);
  return r;
}
