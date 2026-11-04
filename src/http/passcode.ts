import { timingSafeEqual } from 'node:crypto';
import type { RequestHandler } from 'express';

export function requirePasscode(expected: string): RequestHandler {
  return (req, res, next) => {
    const supplied = req.get('x-settle-passcode') ?? '';
    const actual = Buffer.from(supplied);
    const wanted = Buffer.from(expected);
    if (actual.length !== wanted.length || !timingSafeEqual(actual, wanted)) {
      res.status(401).json({ error: 'passcode' });
      return;
    }
    next();
  };
}
