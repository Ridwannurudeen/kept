export type Money = { currency_code: string; value: string };

export type Link = { href: string; rel: string; method?: string };

export type Dispute = {
  dispute_id: string;
  create_time: string;
  update_time: string;
  reason: string;
  status: string;
  dispute_state?: string;
  dispute_life_cycle_stage: string;
  dispute_amount: Money;
  seller_response_due_date?: string;
  buyer_response_due_date?: string;
  disputed_transactions?: { seller_transaction_id?: string; buyer_transaction_id?: string; gross_amount?: Money; items?: unknown[] }[];
  fund_movements?: { party: 'SELLER' | 'BUYER' | 'RECEIVER' | 'PAYMENT_PROCESSOR'; type: 'DEBIT' | 'CREDIT'; reason: string; amount: Money; initiated_time?: string }[];
  dispute_outcome?: { outcome_code: string; amount_refunded?: Money };
  offer?: { seller_offered_amount?: Money; buyer_requested_amount?: Money; offer_type?: string; history?: unknown[] };
  supporting_info?: { notes?: string; source?: string; provided_time?: string }[];
  evidences?: { evidence_type: string; notes?: string; source?: string; date?: string }[];
  allowed_response_options?: { accept_claim?: { accept_claim_types?: string[] }; make_offer?: { offer_types?: string[] } };
  links?: Link[];
};

export type DisputeListItem = Pick<
  Dispute,
  | 'dispute_id'
  | 'create_time'
  | 'update_time'
  | 'reason'
  | 'status'
  | 'dispute_state'
  | 'dispute_amount'
  | 'dispute_life_cycle_stage'
  | 'buyer_response_due_date'
  | 'seller_response_due_date'
  | 'links'
>;

export type DisputeList = { items?: DisputeListItem[]; links?: Link[] };

export type Capture = {
  id: string;
  status: string;
  amount: Money;
  create_time?: string;
  update_time?: string;
  status_details?: { reason?: string };
  seller_protection?: { status: string; dispute_categories?: string[] };
};

export type Order = {
  id: string;
  status: string;
  create_time?: string;
  purchase_units: {
    amount: Money;
    items?: unknown[];
    shipping?: {
      name?: { full_name?: string };
      address?: Record<string, string>;
      trackers?: { id: string; status: string; create_time?: string }[];
    };
    payments?: { captures?: Capture[] };
  }[];
  links?: Link[];
};
