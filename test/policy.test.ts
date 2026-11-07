import { ZodError } from 'zod';
import { breakEven, checkOffer, deadlineStatus, defaultPolicy, offerCap, parseAmount, parsePolicy, toCents } from '../src/policy.js';

test('PayPal disputed amounts accept zero or one decimal while seller offers stay strict', () => {
  expect(parseAmount('36')).toBe(3600);
  expect(parseAmount('36.5')).toBe(3650);
  expect(() => toCents('36')).toThrow('Invalid money amount');
  expect(() => toCents('36.5')).toThrow('Invalid money amount');
  expect(offerCap('36.5', defaultPolicy)).toBe('10.95');
});

test('cap is the lowest of percent, absolute and disputed, floored to cents', () => {
  expect(offerCap('36.00', defaultPolicy)).toBe('10.80');
  expect(offerCap('36.01', { ...defaultPolicy, maxOfferPercent: 33 })).toBe('11.88');
  expect(offerCap('500.00', defaultPolicy)).toBe('50.00');
  expect(offerCap('12.00', { ...defaultPolicy, maxOfferPercent: 100, maxOfferAbsolute: '999.00' })).toBe('12.00');
});
test('refuses above the percent cap and names it', () => {
  expect(checkOffer('12.00', '36.00', defaultPolicy)).toEqual({ ok: false, cap: '10.80', limit: 'percent', message: 'Offer 12.00 is above the policy cap of 10.80 (30% of 36.00)' });
});
test('formats PayPal disputed amounts with two decimals in seller messages', () => {
  expect(checkOffer('12.00', '36.5', defaultPolicy)).toMatchObject({ message: 'Offer 12.00 is above the policy cap of 10.95 (30% of 36.50)' });
});
test('refuses above the absolute cap', () => {
  expect(checkOffer('60.00', '500.00', defaultPolicy)).toMatchObject({ ok: false, limit: 'absolute', message: 'Offer 60.00 is above the absolute cap of 50.00' });
});
test('refuses above the disputed amount even when caps allow it', () => {
  expect(checkOffer('40.00', '36.00', { ...defaultPolicy, maxOfferPercent: 100, maxOfferAbsolute: '999.00' })).toMatchObject({ ok: false, limit: 'disputed' });
});
test('refuses zero, negative and malformed offers', () => {
  expect(checkOffer('0.00', '36.00', defaultPolicy)).toMatchObject({ ok: false, limit: 'zero' });
  expect(checkOffer('-1.00', '36.00', defaultPolicy)).toMatchObject({ ok: false, limit: 'format' });
  expect(checkOffer('9', '36.00', defaultPolicy)).toMatchObject({ ok: false, limit: 'format' });
  expect(checkOffer('9.001', '36.00', defaultPolicy)).toMatchObject({ ok: false, limit: 'format' });
});
test('accepts an offer exactly at the cap', () => {
  expect(checkOffer('10.80', '36.00', defaultPolicy)).toEqual({ ok: true, cap: '10.80' });
});
test('never clamps: the returned cap is informational and the offer is unchanged', () => {
  const r = checkOffer('12.00', '36.00', defaultPolicy); expect(r.ok).toBe(false); expect('offer' in r).toBe(false);
});
test('deadline inside the buffer is due_soon, outside is ok, missing is unknown, past is passed', () => {
  const now = new Date('2026-11-10T12:00:00Z');
  expect(deadlineStatus('2026-11-11T12:00:00Z', now, defaultPolicy)).toEqual({ state: 'due_soon', hoursLeft: 24 });
  expect(deadlineStatus('2026-11-25T12:00:00Z', now, defaultPolicy)).toEqual({ state: 'ok', hoursLeft: 360 });
  expect(deadlineStatus('2026-11-25T12:00:00Z', now, { ...defaultPolicy, deadlineBufferHours: 400 })).toEqual({ state: 'due_soon', hoursLeft: 360 });
  expect(deadlineStatus(undefined, now, defaultPolicy)).toEqual({ state: 'unknown', hoursLeft: null });
  expect(deadlineStatus('2026-11-09T12:00:00Z', now, defaultPolicy)).toEqual({ state: 'passed', hoursLeft: -24 });
});
test('parsePolicy rejects out-of-range and malformed settings', () => {
  expect(() => parsePolicy({ maxOfferPercent: 101, maxOfferAbsolute: '50.00', deadlineBufferHours: 48 })).toThrow();
  expect(() => parsePolicy({ maxOfferPercent: 30, maxOfferAbsolute: '50', deadlineBufferHours: 48 })).toThrow();
  expect(() => parsePolicy({ maxOfferPercent: 30, maxOfferAbsolute: '50.00', deadlineBufferHours: -1 })).toThrow();
  expect(parsePolicy({ maxOfferPercent: 30, maxOfferAbsolute: '50.00', deadlineBufferHours: 400 })).toEqual({ maxOfferPercent: 30, maxOfferAbsolute: '50.00', deadlineBufferHours: 400, disputeFeeTier: 'standard' });
});

test('parsePolicy bounds maxOfferAbsolute at 1000000.00 so offerCap cannot throw', () => {
  const base = { maxOfferPercent: 30, deadlineBufferHours: 48 };
  expect(parsePolicy({ ...base, maxOfferAbsolute: '1000000.00' }).maxOfferAbsolute).toBe('1000000.00');
  expect(() => parsePolicy({ ...base, maxOfferAbsolute: '1000000.01' })).toThrow(ZodError);
  expect(() => parsePolicy({ ...base, maxOfferAbsolute: '99999999999999999999.00' })).toThrow(ZodError);
});

test('break-even uses the Standard fee rules in integer cents', () => {
  expect(breakEven('20.00', '5.00', 'standard')).toMatchObject({ percent: 75, loseCost: '20.00', winCost: '0.00', feeApplied: '0.00' });
  expect(breakEven('30.00', '5.00', 'standard')).toMatchObject({ loseCost: '45.00', feeApplied: '15.00' });
  expect(breakEven('36.00', '9.00', 'standard')?.percent).toBe(82);
  expect(breakEven('20.00', '14.20', 'standard')?.percent).toBe(29);
  expect(breakEven('100.00', '10.00', 'standard')?.percent).toBe(91);
  expect(breakEven('100.00', '21.16', 'standard')?.percent).toBe(81);
});

test('break-even percentage is maximal and its middle-branch wording is false-safe', () => {
  const amounts = new Set<number>();
  for (let amount = 1; amount <= 20000; amount += 1000) amounts.add(amount);
  for (const amount of [2999, 3000, 3001, 20000]) amounts.add(amount);
  for (const tier of ['standard', 'high_volume'] as const) {
    for (const amount of amounts) {
      for (let offer = 1; offer <= amount + 100; offer += 1) {
        const result = breakEven(`${Math.floor(amount / 100)}.${String(amount % 100).padStart(2, '0')}`, `${Math.floor(offer / 100)}.${String(offer % 100).padStart(2, '0')}`, tier);
        if (!result) continue;
        const lose = Number(result.loseCost.replace('.', ''));
        const win = Number(result.winCost.replace('.', ''));
        if (offer >= lose) expect(result.note).toBe('An offer this size costs at least as much as losing a fight.');
        else if (offer <= win) expect(result.note).toBe(`Offering USD ${Math.floor(offer / 100)}.${String(offer % 100).padStart(2, '0')} costs less than fighting even if you would win.`);
        else {
          expect(result.percent).toBeLessThan(100);
          expect(result.note).toBe('');
          if (result.percent > 0 && result.percent < 100) {
            expect(100 * offer).toBeLessThanOrEqual(result.percent * win + (100 - result.percent) * lose);
            expect(100 * offer).toBeGreaterThan((result.percent + 1) * win + (99 - result.percent) * lose);
          }
        }
      }
    }
  }
}, 30000);

test('break-even clamps High Volume to 100 and explains when settling always costs less', () => {
  expect(breakEven('36.00', '9.00', 'high_volume')).toMatchObject({
    percent: 100,
    loseCost: '66.00',
    winCost: '30.00',
    feeApplied: '30.00',
    note: 'Offering USD 9.00 costs less than fighting even if you would win.',
  });
});

test('break-even rejects invalid, zero and over-loss offers while explaining equal-cost offers', () => {
  expect(breakEven('36.00', 'bad', 'standard')).toBeNull();
  expect(breakEven('36.00', '9', 'standard')).toBeNull();
  expect(breakEven('36.00', '0.00', 'standard')).toBeNull();
  expect(breakEven('36.00', '51.00', 'standard')).toMatchObject({ percent: 0, note: 'An offer this size costs at least as much as losing a fight.' });
  expect(breakEven('36.00', '50.99', 'standard')?.percent).toBe(0);
});

test('parsePolicy defaults a missing fee tier and validates supplied tiers', () => {
  expect(defaultPolicy.disputeFeeTier).toBe('standard');
  expect(parsePolicy({ maxOfferPercent: 30, maxOfferAbsolute: '50.00', deadlineBufferHours: 48 })).toMatchObject({ disputeFeeTier: 'standard' });
  expect(parsePolicy({ ...defaultPolicy, disputeFeeTier: 'high_volume' }).disputeFeeTier).toBe('high_volume');
  expect(() => parsePolicy({ ...defaultPolicy, disputeFeeTier: 'premium' })).toThrow();
});
