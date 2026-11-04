import type { ActionKind } from './paypal/dispute.js';
import type { Decision } from './decision.js';
import type { CallRecord } from './paypal/client.js';

export type ActionEntry = { id: string; at: string; disputeId: string; caseKey: string | null; action: ActionKind; recommended: Decision | null; submitted: { note: string; offerAmount: string | null }; sellerEdited: boolean; paypal: { ok: boolean; status: number | null; requestId: string | null; debugId: string | null; durationMs: number; message: string | null }; after: { status: string; stage: string; outcome: string | null } | null };
export type CallEntry = CallRecord & { id: string };
export const MAX_CALLS = 500;

export function appendAction(list: ActionEntry[], e: ActionEntry): ActionEntry[] { return [...list, e]; }
export function appendCall(list: CallEntry[], c: CallEntry): CallEntry[] { return [...list, c].slice(-MAX_CALLS); }
export function hasSentAction(list: ActionEntry[], disputeId: string): boolean { return list.some(entry => entry.disputeId === disputeId && entry.paypal.ok); }
