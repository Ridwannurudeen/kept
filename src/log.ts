import { randomUUID } from 'node:crypto';
import type { ActionKind } from './paypal/dispute.js';
import type { Decision } from './decision.js';
import type { CallRecord } from './paypal/client.js';
import type { Store } from './store.js';

export type ActionEntry = { id: string; at: string; disputeId: string; caseKey: string | null; action: ActionKind; recommended: Decision | null; submitted: { note: string; offerAmount: string | null }; sellerEdited: boolean; paypal: { ok: boolean; status: number | null; requestId: string | null; debugId: string | null; durationMs: number; message: string | null }; after: { status: string; stage: string; outcome: string | null } | null };
export type CallEntry = CallRecord & { id: string };
export const MAX_CALLS = 500;

export function appendAction(list: ActionEntry[], e: ActionEntry): ActionEntry[] { return [...list, e]; }
export function appendCall(list: CallEntry[], c: CallEntry): CallEntry[] { return [...list, c].slice(-MAX_CALLS); }
export function recordCalls(store: Store): (call: CallRecord) => void {
  return (call) => {
    try {
      void store.update((state) => {
        state.calls = appendCall(state.calls, { ...call, id: randomUUID() });
      }).catch((error: unknown) => console.error('Failed to record PayPal call', error));
    } catch (error) {
      console.error('Failed to record PayPal call', error);
    }
  };
}
export function hasSentAction(list: ActionEntry[], disputeId: string): boolean { return list.some(entry => entry.disputeId === disputeId && entry.paypal.ok); }
