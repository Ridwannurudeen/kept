import { appendCall, hasSentAction } from '../src/log.js';
import type { CallEntry, ActionEntry } from '../src/log.js';
test('appendCall keeps at most 500 entries, newest last', () => { const list = Array.from({ length: 500 }, (_, i) => ({ id: String(i) })) as CallEntry[]; expect(appendCall(list, { id: 'new' } as CallEntry)).toHaveLength(500); expect(appendCall(list, { id: 'new' } as CallEntry)[0].id).toBe('1'); expect(appendCall(list, { id: 'new' } as CallEntry).at(-1)?.id).toBe('new'); });
test('hasSentAction is true only for entries PayPal accepted', () => { const base = { disputeId: 'd', paypal: { ok: false } } as ActionEntry; expect(hasSentAction([base], 'd')).toBe(false); expect(hasSentAction([{ ...base, paypal: { ok: true } }], 'd')).toBe(true); });
