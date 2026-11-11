import { createHash } from 'node:crypto';
import { isUnknownStatus, responseError } from './actions.js';
import { itemNotReceivedItems, type ChecklistItem } from './cases.js';
import { PayPalError } from './paypal/errors.js';
import type { CallRecord, PayPalClient } from './paypal/client.js';
import type { Capture, Money, Order } from './paypal/types.js';
import type { Store } from './store.js';

export const CARRIERS = ['UPS', 'USPS', 'FEDEX', 'DHL'] as const;
export const ORDER_ID_PATTERN = /^[A-Z0-9]{1,36}$/;
export const TRACKING_NUMBER_PATTERN = /^[A-Z0-9]{8,40}$/;

export type TrackingRequest = { carrier: (typeof CARRIERS)[number]; trackingNumber: string };
export type TrackingAttempt = TrackingRequest & { at: string; ok: boolean; unknown: boolean; status: number | null; requestId: string; debugId: string | null; message: string | null };
export type ShippingCheck = {
  orderId: string;
  itemName: string | null;
  amount: Money | null;
  shipToCity: string | null;
  captureId: string | null;
  protection: { status: string; categories: string[] | null } | null;
  checklist: ChecklistItem[];
  tracker: { id: string; status: string | null; trackingNumber: string | null } | null;
  checkedAt: string;
  tracking: TrackingAttempt | null;
};
export type ShippingDeps = { paypal: PayPalClient; store: Store; now: () => Date };
type TrackingError = { status: number | null; debugId: string | null; message: string; unknown: boolean };
export type TrackingOutcome = { status: 'sent'; check: ShippingCheck } | { status: 'refused'; blockers: string[] } | { status: 'failed'; check: ShippingCheck; error: TrackingError };

const UNKNOWN_OUTCOME_WINDOW_MS = 5 * 60_000;
const inFlight = new Set<string>();
const unlogged = new Map<string, string>();
const unloggedMessage = 'PayPal accepted the tracker but Kept could not record it; do not retry, check the order in PayPal. Restart Kept after checking PayPal.';
const unknownUnloggedMessage = 'The outcome at PayPal is unknown and Kept could not record it; do not retry, check the order in PayPal. Restart Kept after checking PayPal.';
const unknownMessage = 'PayPal sent no answer or a server error; the outcome is unknown. Check the order before retrying.';
const mayHaveReachedMessage = 'The last tracker may have reached PayPal. Check the order in PayPal before retrying.';
const landedMessage = "PayPal's order shows the tracker from the last attempt";
const sentMessage = 'Sent, waiting for PayPal to show it. Check the order again later';

export function resetShippingGuards(): void {
  inFlight.clear();
  unlogged.clear();
}

function captureIdOf(order: Order): string | null {
  return order.purchase_units.flatMap((unit) => unit.payments?.captures ?? [])[0]?.id ?? null;
}

function allTrackersOf(order: Order): { id: string; status?: string }[] {
  return order.purchase_units.flatMap((unit) => unit.shipping?.trackers ?? []);
}

function trackersOf(order: Order): { id: string; status?: string }[] {
  return allTrackersOf(order).filter((tracker) => tracker.status !== 'CANCELLED');
}

function showsTracker(order: Order, trackingNumber: string): boolean {
  return trackersOf(order).some((tracker) => tracker.id === `${captureIdOf(order)}-${trackingNumber}`);
}

function refusalOf(error: unknown): string | null {
  if (!(error instanceof PayPalError) || error.status !== 422) return null;
  const detail = (error.body as { details?: { issue?: string; description?: string }[] } | null)?.details?.[0];
  if (detail?.issue === 'CAPTURE_STATUS_NOT_VALID') return 'PayPal adds tracking only to completed payments, and this payment is not completed (CAPTURE_STATUS_NOT_VALID).';
  return detail?.issue ? `PayPal refused the tracker: ${detail.issue}${detail.description ? `. ${detail.description}` : ''}` : null;
}

function settle(tracking: TrackingAttempt, order: Order): TrackingAttempt {
  if (!tracking.unknown || !showsTracker(order, tracking.trackingNumber)) return tracking;
  return { ...tracking, ok: true, unknown: false, message: landedMessage };
}

function protectionOf(capture: Capture): ShippingCheck['protection'] {
  const protection = capture.seller_protection;
  return protection ? { status: protection.status, categories: protection.dispute_categories ?? null } : null;
}

export function shippingCheckOf(order: Order, protection: ShippingCheck['protection'], checkedAt: string, tracking: TrackingAttempt | null): ShippingCheck {
  const unit = order.purchase_units[0];
  const item = unit?.items?.[0] as { name?: string } | undefined;
  const captureId = captureIdOf(order);
  const tracker = trackersOf(order)[0] ?? allTrackersOf(order)[0];
  return {
    orderId: order.id,
    itemName: item?.name ?? unit?.description ?? null,
    amount: unit ? { currency_code: unit.amount.currency_code, value: unit.amount.value } : null,
    shipToCity: unit?.shipping?.address?.admin_area_2 ?? null,
    captureId,
    protection,
    checklist: itemNotReceivedItems(order),
    tracker: tracker ? { id: tracker.id, status: tracker.status ?? null, trackingNumber: captureId && tracker.id.startsWith(`${captureId}-`) ? tracker.id.slice(captureId.length + 1) : null } : null,
    checkedAt,
    tracking: tracking && settle(tracking, order),
  };
}

export async function checkOrder(orderId: string, deps: ShippingDeps): Promise<{ check: ShippingCheck; warnings: string[] }> {
  const order = await deps.paypal.getOrder(orderId);
  const warnings: string[] = [];
  const captureId = captureIdOf(order);
  if (!captureId) warnings.push("PayPal's order shows no capture, so there is no payment to read Seller Protection from.");
  const capture = captureId ? await deps.paypal.getCapture(captureId).catch((error: unknown) => {
    warnings.push(`PayPal did not return the capture: ${error instanceof Error ? error.message : String(error)}`);
    return null;
  }) : null;
  const state = await deps.store.update((current) => {
    const previous = current.shippingChecks[order.id]?.tracking ?? null;
    const expired = previous?.unknown && !showsTracker(order, previous.trackingNumber) && deps.now().getTime() - Date.parse(previous.at) >= UNKNOWN_OUTCOME_WINDOW_MS;
    current.shippingChecks[order.id] = shippingCheckOf(order, capture && protectionOf(capture), deps.now().toISOString(), expired ? { ...previous, unknown: false } : previous);
  });
  return { check: state.shippingChecks[order.id]!, warnings };
}

export async function addOrderTracking(orderId: string, req: TrackingRequest, deps: ShippingDeps): Promise<TrackingOutcome> {
  const unloggedBlocker = unlogged.get(orderId);
  if (unloggedBlocker) return { status: 'refused', blockers: [unloggedBlocker] };
  if (inFlight.has(orderId)) return { status: 'refused', blockers: ['Tracking for this order is already being sent'] };
  inFlight.add(orderId);
  try {
    const existing = deps.store.get().shippingChecks[orderId];
    if (!existing) return { status: 'refused', blockers: ['Check this order before adding tracking'] };
    const fresh = await deps.paypal.getOrder(orderId);
    const pending = existing.tracking?.unknown ? existing.tracking : null;
    if (pending && showsTracker(fresh, pending.trackingNumber)) {
      await deps.store.update((state) => { state.shippingChecks[orderId] = shippingCheckOf(fresh, existing.protection, deps.now().toISOString(), pending); });
      return { status: 'refused', blockers: [landedMessage] };
    }
    if (pending && deps.now().getTime() - Date.parse(pending.at) < UNKNOWN_OUTCOME_WINDOW_MS) return { status: 'refused', blockers: [mayHaveReachedMessage] };
    if (existing.tracking?.ok && !trackersOf(fresh).length) return { status: 'refused', blockers: [sentMessage] };
    if (trackersOf(fresh).length) return { status: 'refused', blockers: ["PayPal's order already has a tracker. Check the order again to see it"] };
    const captureId = captureIdOf(fresh);
    if (!captureId) return { status: 'refused', blockers: ["PayPal's order has no capture to attach tracking to"] };

    const body = { capture_id: captureId, tracking_number: req.trackingNumber, carrier: req.carrier, notify_payer: false };
    const requestId = `kept-${orderId}-track-${createHash('sha256').update(JSON.stringify(body)).digest('hex').slice(0, 12)}`;
    const start = deps.now();
    const writeCall: { value: CallRecord | null } = { value: null };
    let failure: TrackingError | null = null;
    try {
      await deps.paypal.addTracking(orderId, body, (call) => { writeCall.value = call; }, requestId);
    } catch (error) {
      const response = responseError(error);
      const unknown = isUnknownStatus(response.status);
      failure = { ...response, message: unknown ? unknownMessage : refusalOf(error) ?? response.message, unknown };
    }

    const reRead = await deps.paypal.getOrder(orderId).then((order) => order, () => null);
    const attempt: TrackingAttempt = {
      ...req, at: start.toISOString(), ok: failure === null, unknown: failure?.unknown ?? false,
      status: writeCall.value?.status ?? failure?.status ?? null, requestId, debugId: writeCall.value?.debugId ?? failure?.debugId ?? null, message: failure?.message ?? null,
    };
    const check = shippingCheckOf(reRead ?? fresh, existing.protection, deps.now().toISOString(), attempt);
    if (check.tracking?.ok) failure = null;
    try {
      await deps.store.update((state) => { state.shippingChecks[orderId] = check; });
    } catch (error) {
      if (failure === null) { unlogged.set(orderId, unloggedMessage); throw new Error(unloggedMessage, { cause: error }); }
      if (failure.unknown) { unlogged.set(orderId, unknownUnloggedMessage); throw new Error(unknownUnloggedMessage, { cause: error }); }
      throw error;
    }
    if (failure) return { status: 'failed', check, error: failure };
    return { status: 'sent', check };
  } finally {
    inFlight.delete(orderId);
  }
}
