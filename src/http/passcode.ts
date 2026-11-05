import { createHash, timingSafeEqual } from 'node:crypto';
import type { RequestHandler } from 'express';

const MAX_FAILURES = 5;
const WINDOW_MS = 10 * 60_000;

export function requirePasscode(expected: string, now: () => number = Date.now): RequestHandler {
  const failures = new Map<string, Map<string, number>>();
  return (req, res, next) => {
    const at = now();
    for (const [ip, guesses] of failures) {
      for (const [guess, time] of guesses) if (at - time >= WINDOW_MS) guesses.delete(guess);
      if (guesses.size === 0) failures.delete(ip);
    }
    const ip = req.ip ?? 'unknown';
    if ((failures.get(ip)?.size ?? 0) >= MAX_FAILURES) {
      res.status(429).json({ error: 'too_many_attempts' });
      return;
    }
    const supplied = req.get('x-settle-passcode') ?? '';
    const actual = Buffer.from(supplied);
    const wanted = Buffer.from(expected);
    if (actual.length !== wanted.length || !timingSafeEqual(actual, wanted)) {
      if (supplied !== '') failures.set(ip, (failures.get(ip) ?? new Map()).set(createHash('sha256').update(supplied).digest('hex'), at));
      res.status(401).json({ error: 'passcode' });
      return;
    }
    next();
  };
}
