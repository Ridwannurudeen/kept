import { z } from 'zod';

export type Policy = { maxOfferPercent: number; maxOfferAbsolute: string; deadlineBufferHours: number };

export const defaultPolicy: Policy = { maxOfferPercent: 30, maxOfferAbsolute: '50.00', deadlineBufferHours: 48 };

const policySchema = z.object({
  maxOfferPercent: z.number().int().min(0).max(100),
  maxOfferAbsolute: z.string().regex(/^\d+\.\d{2}$/),
  deadlineBufferHours: z.number().int().min(0).max(2000),
});

export function parsePolicy(input: unknown): Policy {
  return policySchema.parse(input);
}

export function toCents(value: string): number {
  if (!/^\d+\.\d{2}$/.test(value)) throw new Error('Invalid money amount');
  const cents = BigInt(value.replace('.', ''));
  if (cents > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error('Invalid money amount');
  return Number(cents);
}

export function fromCents(cents: number): string {
  if (!Number.isSafeInteger(cents)) throw new Error('Invalid money amount');
  const sign = cents < 0 ? '-' : '';
  const absolute = BigInt(Math.abs(cents));
  return `${sign}${absolute / 100n}.${String(absolute % 100n).padStart(2, '0')}`;
}

export function offerCap(disputed: string, policy: Policy): string {
  const disputedCents = BigInt(toCents(disputed));
  const percentCents = disputedCents * BigInt(policy.maxOfferPercent) / 100n;
  const absoluteCents = BigInt(toCents(policy.maxOfferAbsolute));
  return fromCents(Number([percentCents, absoluteCents, disputedCents].reduce((lowest, value) => value < lowest ? value : lowest)));
}

export type OfferCheck = { ok: true; cap: string } | { ok: false; cap: string; limit: 'percent' | 'absolute' | 'disputed' | 'zero' | 'format'; message: string };

export function checkOffer(offer: string, disputed: string, policy: Policy): OfferCheck {
  if (!/^\d+\.\d{2}$/.test(offer)) {
    return { ok: false, cap: offerCap(disputed, policy), limit: 'format', message: 'Offer must be an amount like 9.00' };
  }
  const offerCents = toCents(offer);
  const disputedCents = toCents(disputed);
  const cap = offerCap(disputed, policy);
  if (offerCents === 0) return { ok: false, cap, limit: 'zero', message: 'Offer must be more than 0.00' };
  if (offerCents <= toCents(cap)) return { ok: true, cap };

  if (offerCents > disputedCents) {
    return { ok: false, cap, limit: 'disputed', message: `Offer ${offer} is above the disputed amount of ${disputed}` };
  }
  if (offerCents > toCents(policy.maxOfferAbsolute)) {
    return { ok: false, cap, limit: 'absolute', message: `Offer ${offer} is above the absolute cap of ${policy.maxOfferAbsolute}` };
  }
  return { ok: false, cap, limit: 'percent', message: `Offer ${offer} is above the policy cap of ${cap} (${policy.maxOfferPercent}% of ${disputed})` };
}

export type DeadlineStatus = { state: 'due_soon' | 'ok' | 'unknown' | 'passed'; hoursLeft: number | null };

export function deadlineStatus(dueIso: string | undefined, now: Date, policy: Policy): DeadlineStatus {
  if (dueIso === undefined) return { state: 'unknown', hoursLeft: null };
  const due = Date.parse(dueIso);
  if (!Number.isFinite(due)) return { state: 'unknown', hoursLeft: null };
  const hoursLeft = (due - now.getTime()) / 3_600_000;
  if (hoursLeft < 0) return { state: 'passed', hoursLeft };
  if (hoursLeft <= policy.deadlineBufferHours) return { state: 'due_soon', hoursLeft };
  return { state: 'ok', hoursLeft };
}
