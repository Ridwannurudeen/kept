import express from 'express';
import request from 'supertest';
import { requirePasscode } from '../../src/http/passcode.js';

function app(now: () => number) {
  const server = express();
  server.set('trust proxy', true);
  server.use(requirePasscode('right', now));
  server.get('/x', (_req, res) => res.json({ ok: true }));
  return server;
}

const attempt = (server: express.Express, passcode: string, ip = '10.0.0.1') => request(server).get('/x').set('x-forwarded-for', ip).set('x-settle-passcode', passcode);

test('five failures from one IP within 10 minutes lock it out with 429 until the window passes', async () => {
  let clock = 0;
  const server = app(() => clock);
  for (let i = 0; i < 5; i++) await attempt(server, `wrong-${i}`).expect(401, { error: 'passcode' });
  await attempt(server, 'wrong').expect(429, { error: 'too_many_attempts' });
  await attempt(server, 'right').expect(429, { error: 'too_many_attempts' });
  await attempt(server, 'right', '10.0.0.2').expect(200);
  clock = 10 * 60_000;
  await attempt(server, 'right').expect(200);
  await attempt(server, 'wrong').expect(401);
});

test('failures older than 10 minutes do not count and successes are never throttled', async () => {
  let clock = 0;
  const server = app(() => clock);
  for (let i = 0; i < 4; i++) await attempt(server, `old-${i}`).expect(401);
  clock = 10 * 60_000;
  await attempt(server, 'new-0').expect(401);
  for (let i = 0; i < 20; i++) await attempt(server, 'right').expect(200);
  for (let i = 1; i < 4; i++) await attempt(server, `new-${i}`).expect(401);
  await attempt(server, 'new-4').expect(401);
  await attempt(server, 'new-5').expect(429);
});

test('requests with no passcode at all (a fresh page load) get 401 but do not count as failures', async () => {
  const server = app(() => 0);
  for (let i = 0; i < 10; i++) await request(server).get('/x').set('x-forwarded-for', '10.0.0.1').expect(401, { error: 'passcode' });
  await attempt(server, 'right').expect(200);
});

test('the same wrong passcode resent by parallel page requests counts once', async () => {
  const server = app(() => 0);
  for (let i = 0; i < 10; i++) await attempt(server, 'typo').expect(401);
  await attempt(server, 'right').expect(200);
});
