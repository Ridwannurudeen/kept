"use strict";

(() => {
  const PASSCODE_KEY = "kept.passcode";
  const AUTO_HEIGHT_LIMIT = 20;
  const TOTAL_ID = "__total__";
  const POLL_MS = 2000;
  const CALL_SLACK_MS = 10_000;
  const MAX_ATTACHMENT_BYTES = 5 * 1024 * 1024;

  const els = {
    layout: document.getElementById("layout"),
    grid: document.getElementById("grid"),
    gridFrame: document.getElementById("grid-frame"),
    strip: document.getElementById("summary-strip"),
    fetchStatus: document.getElementById("fetch-status"),
    quickFilter: document.getElementById("quick-filter"),
    refresh: document.getElementById("refresh-button"),
    decideAll: document.getElementById("decide-all-button"),
    footer: document.getElementById("footer"),
    announcer: document.getElementById("announcer"),
    panel: document.getElementById("panel"),
    panelTitle: document.getElementById("panel-title"),
    panelBody: document.getElementById("panel-body"),
    panelClose: document.getElementById("panel-close"),
    replayBanner: document.getElementById("replay-banner"),
    confirmDialog: document.getElementById("confirm-dialog"),
    confirmText: document.getElementById("confirm-text"),
    confirmSummary: document.getElementById("confirm-summary"),
    dialog: document.getElementById("passcode-dialog"),
    passcodeForm: document.getElementById("passcode-form"),
    passcodeInput: document.getElementById("passcode-input"),
    passcodeError: document.getElementById("passcode-error"),
    policyButton: document.getElementById("policy-button"),
    policyDialog: document.getElementById("policy-dialog"),
    policyForm: document.getElementById("policy-form"),
    policyError: document.getElementById("policy-error"),
    policySave: document.getElementById("policy-save"),
    policyCancel: document.getElementById("policy-cancel"),
    compare: document.getElementById("compare"),
    compareTitle: document.getElementById("compare-title"),
    compareClose: document.getElementById("compare-close"),
    comparePick: document.getElementById("compare-pick"),
    compareSelect: document.getElementById("compare-select"),
    compareBody: document.getElementById("compare-body"),
    calls: document.getElementById("calls"),
    callsCount: document.getElementById("calls-count"),
    callsScroll: document.getElementById("calls-scroll"),
  };

  let gridApi = null;
  let summaryText = null;
  let passcodePrompt = null;
  let pollTimer = null;
  const reasonsById = new Map();
  const decideState = new Map();
  const sentById = new Map();
  const resultById = new Map();
  let panelId = null;
  let panelDetail = null;
  let returnFocus = null;
  let approving = false;
  let replay = false;
  let compareReturn = null;
  let calls = [];
  const isPending = (job) =>
    job?.state === "queued" || job?.state === "running";

  // ---------- formatting ----------

  const money = (m) => (m ? `${m.currency_code} ${m.value}` : "");
  const toCents = (m) => (m ? Math.round(Number(m.value) * 100) : null);
  const shortId = (id) => id.replace(/^PP-[A-Z]-/, "");
  const dayFormat = new Intl.DateTimeFormat("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  });
  const stampFormat = new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
  const timeFormat = new Intl.DateTimeFormat("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
  });
  const callFormat = new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  const recordedFormat = new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
  const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;
  const formatSize = (bytes) =>
    bytes < 1024
      ? `${bytes} B`
      : bytes < 1024 * 1024
        ? `${(bytes / 1024).toFixed(1)} KB`
        : `${(bytes / 1024 / 1024).toFixed(1)} MB`;

  function relativeDue(deadline) {
    const hours = deadline.hoursLeft;
    if (hours === null) return "";
    if (deadline.state === "passed") {
      const days = Math.floor(-hours / 24);
      return days === 0 ? "overdue" : `overdue by ${plural(days, "day")}`;
    }
    if (hours < 24)
      return `in ${plural(Math.max(1, Math.round(hours)), "hour")}`;
    return `in ${plural(Math.floor(hours / 24), "day")}`;
  }

  function statusChip(row) {
    if (!row.open) return { text: "Resolved", cls: "chip-resolved" };
    if (row.headline.startsWith("Your offer of"))
      return { text: "Offer pending", cls: "chip-offer" };
    if (row.status === "UNDER_REVIEW")
      return { text: "Under review", cls: "chip-review" };
    return { text: "Open", cls: "chip-open" };
  }

  function actionText(row) {
    const sent = sentById.get(row.disputeId);
    if (sent) {
      const amount = sent.submitted.offerAmount
        ? ` ${row.amount.currency_code} ${sent.submitted.offerAmount}`
        : "";
      return `Sent ${sent.action}${amount}`;
    }
    return row.actionTaken ? `Sent ${row.actionTaken}` : "";
  }

  function el(tag, cls, text) {
    const node = document.createElement(tag);
    if (cls) node.className = cls;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  // ---------- announcements ----------

  function announce(text) {
    els.announcer.textContent = "";
    requestAnimationFrame(() => {
      els.announcer.textContent = text;
    });
  }

  // ---------- API with passcode ----------

  function askPasscode(rejected) {
    if (passcodePrompt) return passcodePrompt;
    passcodePrompt = new Promise((resolve, reject) => {
      els.passcodeError.hidden = !rejected;
      els.passcodeInput.value = "";
      const onClose = () => {
        els.dialog.removeEventListener("close", onClose);
        passcodePrompt = null;
        const value = els.passcodeInput.value;
        if (els.dialog.returnValue === "ok" && value) {
          sessionStorage.setItem(PASSCODE_KEY, value);
          resolve();
        } else {
          reject(new Error("A passcode is needed to load cases."));
        }
      };
      els.dialog.returnValue = "";
      els.dialog.addEventListener("close", onClose);
      els.dialog.showModal();
      els.passcodeInput.focus();
    });
    return passcodePrompt;
  }

  async function authedFetch(path, init = {}) {
    const send = () => {
      const headers = new Headers(init.headers);
      const code = sessionStorage.getItem(PASSCODE_KEY);
      if (code) headers.set("x-kept-passcode", code);
      return fetch(path, { ...init, headers });
    };
    let res = await send();
    if (res.status === 401) {
      const hadCode = sessionStorage.getItem(PASSCODE_KEY) !== null;
      sessionStorage.removeItem(PASSCODE_KEY);
      await askPasscode(hadCode);
      res = await send();
      if (res.status === 401) {
        sessionStorage.removeItem(PASSCODE_KEY);
        throw new Error("That passcode was not accepted.");
      }
    }
    if (res.status === 429)
      throw new Error(
        "Too many wrong passcodes from this network. Try again in 10 minutes.",
      );
    return res;
  }

  async function api(path, init = {}) {
    const res = await authedFetch(path, init);
    const body = await res.json();
    if (!res.ok) {
      const message =
        body.message ||
        `Server returned ${res.status}${body.error ? ` (${body.error})` : ""}`;
      throw new Error(message);
    }
    return body;
  }

  // ---------- outcome strip ----------

  function stat(label, value, note, title) {
    const wrap = el("div", "stat");
    wrap.title = title;
    wrap.append(el("dt", "stat-label", label), el("dd", "stat-value", value));
    if (note) wrap.append(el("dd", "stat-note", note));
    return wrap;
  }

  function renderSummary(summary) {
    const currency = summary.currency || "USD";
    const zero = `${currency} 0.00`;
    const items = [];
    if (summary.resolved === 0) {
      const empty = stat(
        "Resolved cases",
        "No resolved cases yet",
        "",
        "None of these disputes has been resolved yet",
      );
      empty.classList.add("stat-empty");
      items.push(empty);
    } else {
      const days = summary.medianDaysToClose;
      items.push(
        stat(
          "Kept after resolution",
          money(summary.kept),
          "",
          "disputed_transactions[0].gross_amount (or dispute_amount) minus dispute_outcome.amount_refunded, on resolved cases; a seller-favour close with no amount_refunded counts as 0.00 refunded",
        ),
        stat(
          "Refunded",
          money(summary.refunded),
          "",
          "Sum of dispute_outcome.amount_refunded on resolved cases",
        ),
        stat(
          "Resolved",
          String(summary.resolved),
          days === null ? "" : `median ${plural(days, "day")} to close`,
          "Disputes with status RESOLVED; days from create_time to update_time",
        ),
      );
    }
    const holding = summary.heldByPayPal
      ? `PayPal holding ${money(summary.heldByPayPal)}`
      : "No funds on hold";
    items.push(
      stat(
        "Open at stake",
        money(summary.openAtStake) || zero,
        holding,
        "dispute_amount on open cases; holds from fund_movements with reason HOLD_PLACED",
      ),
    );
    els.strip.replaceChildren(...items);

    const text = [...els.strip.querySelectorAll(".stat")]
      .map((node) =>
        [...node.children]
          .map((child) => child.textContent)
          .filter(Boolean)
          .join(" "),
      )
      .join(". ");
    if (summaryText !== null && summaryText !== text)
      announce(`Outcomes updated. ${text}`);
    summaryText = text;
  }

  function totalRow(summary) {
    return {
      disputeId: TOTAL_ID,
      caseKey: "Total",
      amount: summary.openAtStake,
      hold: summary.heldByPayPal,
      outcome: summary.kept ? { kept: summary.kept } : null,
    };
  }

  // ---------- cell renderers ----------

  function caseCell(p) {
    const wrap = el("div", "cell-stack");
    if (p.node.rowPinned) {
      wrap.append(
        el("span", "cell-line", "Total"),
        el("span", "cell-line cell-sub", "Open, held, kept"),
      );
      return wrap;
    }
    wrap.append(
      el("span", "cell-line", p.data.caseKey || "Not seeded"),
      el("span", "cell-line cell-sub cell-mono", shortId(p.data.disputeId)),
    );
    return wrap;
  }

  function statusCell(p) {
    if (p.node.rowPinned) return "";
    const chip = statusChip(p.data);
    const wrap = el("div", "cell-stack");
    const top = el("span", "cell-line");
    top.append(el("span", `chip ${chip.cls}`, chip.text));
    wrap.append(top, el("span", "cell-line cell-sub", p.data.headline));
    return wrap;
  }

  function dueCell(p) {
    if (p.node.rowPinned || !p.data.open) return "";
    if (!p.data.dueAt) return el("span", "cell-muted", "No date from PayPal");
    const dueSoon = p.data.deadline.state === "due_soon";
    const wrap = el("div", "cell-stack");
    const top = el("span", "cell-line cell-inline");
    top.append(
      el(
        "span",
        dueSoon ? "due-soon-text" : "",
        dayFormat.format(new Date(p.data.dueAt)).replace(",", ""),
      ),
    );
    if (dueSoon) top.append(el("span", "chip chip-due", "Due soon"));
    wrap.append(
      top,
      el(
        "span",
        `cell-line cell-sub${dueSoon ? " due-soon-text" : ""}`,
        relativeDue(p.data.deadline),
      ),
    );
    return wrap;
  }

  function recommendationCell(p) {
    if (p.node.rowPinned) return "";
    const row = p.data;
    const wrap = el("div", "cell-inline");
    const state = decideState.get(row.disputeId);
    const label = row.caseKey || shortId(row.disputeId);
    if (isPending(state)) {
      const busy = el("button", "button button-small", "Deciding…");
      busy.type = "button";
      busy.disabled = true;
      busy.setAttribute("aria-label", `Deciding case ${label}`);
      wrap.append(busy);
      return wrap;
    }
    if (row.recommendation) {
      wrap.append(
        el(
          "span",
          `badge badge-${row.recommendation.toLowerCase()}`,
          row.recommendation,
        ),
      );
      if (row.recommendationStale)
        wrap.append(el("span", "chip chip-stale", "Stale"));
      return wrap;
    }
    if (!row.open) return "";
    const failed = state?.state === "failed";
    const button = el(
      "button",
      failed ? "button button-small button-failed" : "button button-small",
      failed ? "Failed: retry" : "Decide",
    );
    button.type = "button";
    if (failed) button.title = state.detail;
    button.setAttribute(
      "aria-label",
      failed
        ? `Failed: retry deciding case ${label}. ${state.detail}`
        : `Decide case ${label}`,
    );
    button.addEventListener("click", (event) => {
      event.stopPropagation();
      decide(row.disputeId);
    });
    wrap.append(button);
    return wrap;
  }

  function refreshRecommendations() {
    gridApi.refreshCells({ columns: ["recommendation"], force: true });
  }

  // ---------- decide in place ----------

  async function decide(id) {
    if (isPending(decideState.get(id))) return;
    const label = gridApi.getRowNode(id).data.caseKey || shortId(id);
    decideState.set(id, { state: "running", posting: true });
    refreshRecommendations();
    announce(`Deciding case ${label}`);
    try {
      const result = await api(`/api/cases/${encodeURIComponent(id)}/decide`, {
        method: "POST",
      });
      if (!result.ok) throw new Error(result.detail || result.error);
      decideState.delete(id);
      reasonsById.set(id, result.decision.reasons[0]);
      const current = gridApi.getRowNode(id).data;
      gridApi.applyTransaction({
        update: [
          {
            ...current,
            recommendation: result.decision.recommendation,
            recommendationStale: false,
            staleReason: null,
          },
        ],
      });
      refreshRecommendations();
      announce(
        `Case ${label}: Kept recommends ${result.decision.recommendation}`,
      );
    } catch (error) {
      decideState.set(id, { state: "failed", detail: error.message });
      refreshRecommendations();
      announce(`Case ${label}: no decision yet. ${error.message}`);
    }
  }

  // ---------- decide queue ----------

  function schedulePoll() {
    if (pollTimer === null) pollTimer = setTimeout(pollStatus, POLL_MS);
  }

  async function pollStatus() {
    pollTimer = null;
    try {
      const jobs = await api("/api/decide/status");
      const finished = [];
      const notes = [];
      for (const [id, job] of Object.entries(jobs)) {
        const local = decideState.get(id);
        if (local?.posting) continue;
        if (job.state === "done") {
          if (local) finished.push(id);
          continue;
        }
        if (job.state === "failed" && isPending(local))
          notes.push(
            `Case ${gridApi.getRowNode(id)?.data.caseKey || shortId(id)}: no decision yet`,
          );
        decideState.set(id, { state: job.state, detail: job.error });
      }
      if (finished.length) {
        const data = await api("/api/cases");
        for (const id of finished) decideState.delete(id);
        const rows = data.cases.filter(
          (row) =>
            finished.includes(row.disputeId) &&
            gridApi.getRowNode(row.disputeId),
        );
        gridApi.applyTransaction({ update: rows });
        if (panelId && finished.includes(panelId)) loadPanel(panelId);
        for (const row of rows)
          notes.push(
            `Case ${row.caseKey || shortId(row.disputeId)}: Kept recommends ${row.recommendation}`,
          );
      }
      refreshRecommendations();
      if (notes.length) announce(notes.join(". "));
      const pending = [...decideState.values()].some(isPending);
      els.decideAll.disabled = pending;
      if (pending) schedulePoll();
    } catch (error) {
      els.decideAll.disabled = false;
      els.fetchStatus.classList.add("is-warning");
      els.fetchStatus.textContent = `Could not check decision progress. ${error.message}`;
      announce(`Could not check decision progress. ${error.message}`);
    }
  }

  async function decideAll() {
    els.decideAll.disabled = true;
    try {
      const { queued } = await api("/api/cases/decide-all", { method: "POST" });
      for (const id of queued)
        if (!decideState.get(id)?.posting)
          decideState.set(id, { state: "queued" });
      refreshRecommendations();
      announce(`Deciding ${plural(queued.length, "case")}`);
      schedulePoll();
    } catch (error) {
      els.decideAll.disabled = false;
      els.fetchStatus.classList.add("is-warning");
      els.fetchStatus.textContent = `Could not start deciding. ${error.message}`;
      announce(`Could not start deciding. ${error.message}`);
    }
  }

  // ---------- case panel ----------

  const ACTION_LABELS = {
    make_offer: "Offer",
    provide_supporting_info: "Supporting information",
    provide_evidence: "Evidence",
    accept_claim: "Accepted the claim",
  };

  const centsOf = (value) => {
    const match = /^(\d+)(?:\.(\d{1,2}))?$/.exec(value);
    if (!match) return null;
    return Number(match[1]) * 100 + Number((match[2] || "").padEnd(2, "0"));
  };
  const fromCents = (cents) =>
    `${Math.floor(cents / 100)}.${String(cents % 100).padStart(2, "0")}`;

  function checkOffer(offer, disputed, policy) {
    const disputedCents = centsOf(disputed);
    if (disputedCents === null || centsOf(policy.maxOfferAbsolute) === null)
      return { ok: false, message: "Disputed amount is not a valid amount" };
    const cap = fromCents(
      Math.min(
        Math.floor((disputedCents * policy.maxOfferPercent) / 100),
        centsOf(policy.maxOfferAbsolute),
        disputedCents,
      ),
    );
    if (!/^\d+\.\d{2}$/.test(offer))
      return { ok: false, message: "Offer must be an amount like 9.00" };
    const offerCents = centsOf(offer);
    if (offerCents === 0)
      return { ok: false, message: "Offer must be more than 0.00" };
    if (offerCents <= centsOf(cap)) return { ok: true, cap };
    if (offerCents > disputedCents)
      return {
        ok: false,
        message: `Offer ${offer} is above the disputed amount of ${disputed}`,
      };
    if (offerCents > centsOf(policy.maxOfferAbsolute))
      return {
        ok: false,
        message: `Offer ${offer} is above the absolute cap of ${policy.maxOfferAbsolute}`,
      };
    return {
      ok: false,
      message: `Offer ${offer} is above the policy cap of ${cap} (${policy.maxOfferPercent}% of ${disputed})`,
    };
  }

  function capText(detail) {
    if (!detail.cap) return "";
    const currency = detail.amount.currency_code;
    const { maxOfferPercent, maxOfferAbsolute } = detail.policy;
    const capCents = centsOf(detail.cap);
    const disputedCents = centsOf(detail.amount.value);
    const base = `Policy cap ${currency} ${detail.cap}`;
    if (disputedCents === null) return base;
    if (capCents === Math.floor((disputedCents * maxOfferPercent) / 100))
      return `${base} = ${maxOfferPercent}% of ${money(detail.amount)}`;
    if (capCents === centsOf(maxOfferAbsolute))
      return `${base} = your ${currency} ${maxOfferAbsolute} limit`;
    return `${base} = the disputed amount`;
  }

  function sentEntry(detail) {
    return detail.actions.filter((entry) => entry.paypal.ok).at(-1) || null;
  }

  function panelAction(detail) {
    const sent = sentEntry(detail);
    if (sent) return sent.action;
    const allowed = detail.allowed;
    const recommendation = detail.decision?.decision.recommendation;
    if (recommendation === "SETTLE") return "make_offer";
    if (recommendation === "ACCEPT") return "accept_claim";
    if (recommendation === "FIGHT")
      return allowed.includes("provide_supporting_info")
        ? "provide_supporting_info"
        : "provide_evidence";
    return (
      [
        "make_offer",
        "provide_supporting_info",
        "provide_evidence",
        "accept_claim",
      ].find((kind) => allowed.includes(kind)) || null
    );
  }

  function approveLabel(action, detail) {
    if (action === "make_offer") return "Send offer to PayPal";
    if (action === "provide_supporting_info")
      return "Send supporting information";
    if (action === "provide_evidence") return "Send evidence";
    return `Accept the claim and refund ${money(detail.amount)}`;
  }

  function staleNotice(detail) {
    const reason = detail.staleReason ? ` (${detail.staleReason})` : "";
    return `This case changed since Kept looked at it${reason}. Run Kept again before approving.`;
  }

  function approveBlockers(detail, action, note, offer) {
    if (detail.sent) return ["This case already has a sent action"];
    if (detail.unknownOutcome)
      return ["Outcome unknown: check PayPal before retrying"];
    if (!detail.open) return ["PayPal has closed this case"];
    if (!action) return ["PayPal lists no seller action for this case yet"];
    const blockers = [];
    if (detail.recommendationStale) blockers.push(staleNotice(detail));
    if (!detail.allowed.includes(action))
      blockers.push(
        `PayPal does not list ${action} for this case (stage ${detail.stageLabel})`,
      );
    if (note.trim().length === 0) blockers.push("Note is empty");
    if (note.length > 2000)
      blockers.push("Note is longer than 2000 characters");
    if (action === "make_offer") {
      const check = checkOffer(offer, detail.amount.value, detail.policy);
      if (!check.ok) blockers.push(check.message);
    }
    return blockers;
  }

  function section(title, cls) {
    const wrap = el("section", `panel-section${cls ? ` ${cls}` : ""}`);
    const id = `panel-${title.toLowerCase().replace(/[^a-z]+/g, "-")}`;
    const heading = el("h3", "panel-section-title", title);
    heading.id = id;
    heading.tabIndex = -1;
    wrap.setAttribute("aria-labelledby", id);
    wrap.append(heading);
    return wrap;
  }

  function list(items, empty) {
    if (!items.length) return el("p", "panel-muted", empty);
    const ul = el("ul", "panel-list");
    for (const item of items) ul.append(el("li", "", item));
    return ul;
  }

  function spinner() {
    const node = el("span", "spinner");
    node.setAttribute("aria-hidden", "true");
    return node;
  }

  function panelLabel(detail) {
    return detail.caseKey || shortId(detail.disputeId);
  }

  function renderHead(detail) {
    const wrap = el("div", "panel-meta");
    const chips = el("div", "panel-chips");
    const chip = statusChip(detail);
    chips.append(
      el("span", "chip chip-stage", detail.stageLabel),
      el("span", `chip ${chip.cls}`, chip.text),
      el("span", "panel-amount", money(detail.amount)),
    );
    wrap.append(chips);
    wrap.append(
      el(
        "p",
        "panel-sub",
        `${detail.reasonLabel} · PayPal case ${detail.disputeId}`,
      ),
    );
    if (detail.hold)
      wrap.append(
        el(
          "p",
          "panel-hold",
          `PayPal is holding ${money(detail.hold)} for this case`,
        ),
      );
    if (detail.warnings.length)
      wrap.append(
        el(
          "p",
          "panel-warning",
          `Some PayPal records did not load: ${detail.warnings.join("; ")}`,
        ),
      );
    return wrap;
  }

  function renderAsk(detail) {
    const wrap = section("What PayPal is asking");
    wrap.append(el("p", "panel-lead", detail.explanation.headline));
    if (detail.explanation.detail)
      wrap.append(el("p", "panel-text", detail.explanation.detail));
    if (detail.decision?.decision.plain_ask)
      wrap.append(
        el("p", "panel-text panel-muted", detail.decision.decision.plain_ask),
      );
    return wrap;
  }

  function renderEvidence(detail) {
    const wrap = section("Evidence");
    const columns = el("div", "evidence-columns");
    const have = el("div", "evidence-column");
    const missing = el("div", "evidence-column");
    have.append(el("h4", "evidence-title evidence-have", "Evidence you have"));
    missing.append(
      el("h4", "evidence-title evidence-missing", "Evidence missing"),
    );
    const decision = detail.decision?.decision;
    if (decision) {
      have.append(list(decision.evidence_have, "None listed"));
      missing.append(list(decision.evidence_missing, "Nothing missing"));
    } else {
      have.append(el("p", "panel-muted", "Run Kept to see"));
      missing.append(el("p", "panel-muted", "Run Kept to see"));
    }
    columns.append(have, missing);
    wrap.append(columns);
    return wrap;
  }

  function renderRecommendation(detail) {
    const wrap = section("Recommendation");
    const id = detail.disputeId;
    const state = decideState.get(id);
    const decision = detail.decision?.decision;
    const top = el("div", "panel-row");
    if (decision)
      top.append(
        el(
          "span",
          `badge badge-${decision.recommendation.toLowerCase()}`,
          decision.recommendation,
        ),
      );
    else top.append(el("span", "panel-muted", "Not decided yet"));
    if (detail.open) {
      const button = el("button", "button button-small");
      button.type = "button";
      if (isPending(state)) {
        button.disabled = true;
        button.append(spinner(), document.createTextNode("Deciding…"));
      } else {
        button.textContent =
          state?.state === "failed"
            ? "Retry"
            : decision
              ? "Decide again"
              : "Decide";
        button.addEventListener("click", () => decideInPanel(id));
      }
      top.append(button);
    }
    const compare = el("button", "button button-small button-quiet", "Compare");
    compare.type = "button";
    compare.setAttribute("aria-controls", "compare");
    compare.addEventListener("click", () => openCompare(compare));
    top.append(compare);
    wrap.append(top);
    if (state?.state === "failed" && !isPending(state))
      wrap.append(
        el("p", "panel-error", `No decision yet. ${state.detail || ""}`.trim()),
      );
    if (decision) wrap.append(list(decision.reasons, "No reasons given"));
    if (detail.recommendationStale)
      wrap.append(el("p", "notice notice-stale", staleNotice(detail)));
    return wrap;
  }

  function renderDraftAndApprove(detail) {
    const action = panelAction(detail);
    const decision = detail.decision?.decision;
    const sent = sentEntry(detail);
    const draft = section("Draft");
    const noteId = "draft-note";
    const noteLabel = el(
      "label",
      "field-label",
      "Note to PayPal and the buyer",
    );
    noteLabel.htmlFor = noteId;
    const note = el("textarea", "field-textarea");
    note.id = noteId;
    note.rows = 6;
    note.maxLength = 2000;
    note.defaultValue = sent ? sent.submitted.note : decision?.draft_note || "";
    note.readOnly = Boolean(sent);
    note.placeholder = "Write what PayPal and the buyer will read";
    const count = el("p", "field-hint");
    draft.append(noteLabel, note, count);

    let offer = null;
    const offerHint = el("p", "field-hint");
    offerHint.id = "offer-hint";
    if (action === "make_offer") {
      const row = el("div", "offer-row");
      const label = el(
        "label",
        "field-label",
        `Refund offer (${detail.amount.currency_code})`,
      );
      label.htmlFor = "offer-amount";
      offer = el("input", "field-input offer-input");
      offer.id = "offer-amount";
      offer.inputMode = "decimal";
      offer.autocomplete = "off";
      offer.defaultValue = sent
        ? sent.submitted.offerAmount || ""
        : decision?.offer_amount || "";
      offer.readOnly = Boolean(sent);
      offer.placeholder = "9.00";
      offer.setAttribute("aria-describedby", "offer-cap offer-hint");
      const cap = el("span", "offer-cap", capText(detail));
      cap.id = "offer-cap";
      const field = el("div", "offer-field");
      field.append(offer, cap);
      row.append(label, field, offerHint);
      draft.append(row);
    }

    const approve = section("Approve");
    const button = el(
      "button",
      "button button-primary button-approve",
      action ? approveLabel(action, detail) : "Nothing to send",
    );
    button.type = "button";
    button.setAttribute("aria-describedby", "approve-reason");
    if (approving)
      button.replaceChildren(spinner(), document.createTextNode("Sending…"));
    const reason = el("ul", "approve-reason");
    reason.id = "approve-reason";
    approve.append(button, reason);

    const update = () => {
      count.textContent = `${note.value.length} / 2000 characters`;
      if (offer) {
        const check = checkOffer(
          offer.value.trim(),
          detail.amount.value,
          detail.policy,
        );
        offerHint.textContent = check.ok ? "Within your policy" : check.message;
        offerHint.classList.toggle("is-error", !check.ok);
        offer.setAttribute("aria-invalid", String(!check.ok));
      }
      const blockers = approveBlockers(
        detail,
        action,
        note.value,
        offer ? offer.value.trim() : null,
      );
      button.setAttribute(
        "aria-disabled",
        String(approving || blockers.length > 0),
      );
      reason.replaceChildren(...blockers.map((text) => el("li", "", text)));
      return blockers;
    };
    note.addEventListener("input", update);
    offer?.addEventListener("input", update);
    button.addEventListener("click", () => {
      if (approving) return;
      const blockers = update();
      if (blockers.length) {
        announce(`Not sent. ${blockers.join(". ")}`);
        return;
      }
      confirmAndApprove(detail, {
        action,
        note: note.value,
        offerAmount: offer ? offer.value.trim() : null,
      });
    });
    update();
    return [draft, approve];
  }

  function renderResult(detail) {
    const result = resultById.get(detail.disputeId);
    if (!result) return null;
    const wrap = section("Result");
    if (result.status === 200) {
      const { entry, dispute } = result.body;
      wrap.classList.add("result-ok");
      const facts = el("dl", "result-facts");
      const fact = (label, value) =>
        facts.append(el("dt", "", label), el("dd", "", value));
      if (replay) fact("PayPal status", "Simulated (replay)");
      else if (entry.paypal.status === null)
        fact("PayPal status", "not reported by the toolkit");
      else fact("PayPal HTTP status", String(entry.paypal.status));
      fact("Links on the dispute now", String(dispute.links?.length ?? 0));
      wrap.append(facts);
      wrap.append(
        el(
          "p",
          "panel-lead",
          entry.after
            ? `PayPal now reports: ${entry.after.status} at ${result.body.detail.stageLabel}`
            : "PayPal did not answer the follow-up read. Refresh the case to see its state.",
        ),
      );
    } else if (result.status === 409) {
      wrap.classList.add("result-refused");
      wrap.append(el("p", "panel-lead", "Kept did not send this."));
      wrap.append(list(result.body.blockers, ""));
    } else if (result.status === 0) {
      wrap.classList.add("result-failed");
      wrap.append(
        el("p", "panel-lead", "Outcome unknown: check PayPal before retrying"),
        el("p", "panel-text", result.body.error.message),
      );
    } else {
      wrap.classList.add("result-failed");
      const error = result.body.error || {};
      wrap.append(
        el(
          "p",
          "panel-lead",
          error.unknown
            ? "Outcome unknown: check PayPal before retrying"
            : `PayPal did not accept the action (HTTP ${error.status ?? result.status}).`,
        ),
      );
      if (error.message) wrap.append(el("p", "panel-text", error.message));
      if (error.debugId)
        wrap.append(
          el("p", "panel-muted cell-mono", `Debug id ${error.debugId}`),
        );
    }
    return wrap;
  }

  function renderNotes(detail) {
    const wrap = section("Seller notes");
    const label = el("label", "visually-hidden", "Seller notes");
    label.htmlFor = "seller-notes";
    const notes = el("textarea", "field-textarea");
    notes.id = "seller-notes";
    notes.rows = 4;
    notes.maxLength = 4000;
    notes.defaultValue = detail.record?.notes || "";
    const row = el("div", "panel-row");
    const save = el("button", "button button-small", "Save notes");
    save.type = "button";
    const status = el("span", "field-hint");
    status.setAttribute("role", "status");
    save.addEventListener("click", async () => {
      save.disabled = true;
      status.textContent = "Saving…";
      try {
        await api(`/api/cases/${encodeURIComponent(detail.disputeId)}/notes`, {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ notes: notes.value }),
        });
        notes.defaultValue = notes.value;
        status.textContent = `Saved ${timeFormat.format(new Date())}`;
      } catch (error) {
        status.textContent = `Not saved. ${error.message}`;
      } finally {
        save.disabled = false;
      }
    });
    row.append(save, status);
    wrap.append(label, notes, row);

    const files = el("div", "attachments");
    const renderFiles = () => {
      const all = [
        ...(detail.record?.attachments || []),
        ...detail.attachments,
      ];
      if (!all.length) {
        files.replaceChildren(el("p", "panel-muted", "No attachments yet"));
        return;
      }
      const ul = el("ul", "attachment-list");
      for (const file of all) {
        const li = el("li", "");
        li.append(
          el("span", "attachment-name cell-mono", file.name),
          el("span", "attachment-type", file.type),
          el(
            "span",
            "attachment-size",
            file.size === undefined ? "" : formatSize(file.size),
          ),
        );
        ul.append(li);
      }
      files.replaceChildren(ul);
    };
    renderFiles();

    const upload = el("div", "upload");
    const uploadLabel = el(
      "label",
      "field-label",
      "Add an attachment (any file up to 5 MB)",
    );
    uploadLabel.htmlFor = "attachment-input";
    const input = el("input", "file-input");
    input.type = "file";
    input.id = "attachment-input";
    const uploadStatus = el("p", "field-hint");
    uploadStatus.setAttribute("role", "status");
    input.addEventListener("change", async () => {
      const chosen = input.files[0];
      if (!chosen) return;
      const name = chosen.name.replace(/[^A-Za-z0-9._-]+/g, "-").slice(-100);
      const type = chosen.type || "application/octet-stream";
      uploadStatus.classList.remove("is-error");
      if (chosen.size > MAX_ATTACHMENT_BYTES || !/^[A-Za-z0-9._-]{1,100}$/.test(name) || name === "." || name === "..") {
        uploadStatus.classList.add("is-error");
        uploadStatus.textContent =
          chosen.size > MAX_ATTACHMENT_BYTES
            ? `Not attached. ${chosen.name} is ${formatSize(chosen.size)}; the limit is 5 MB.`
            : "Not attached. Give the file a name with letters or numbers.";
        input.value = "";
        return;
      }
      input.disabled = true;
      uploadStatus.textContent = `Attaching ${name}…`;
      try {
        const saved = await api(
          `/api/cases/${encodeURIComponent(detail.disputeId)}/attachments?name=${encodeURIComponent(name)}&type=${encodeURIComponent(type)}`,
          { method: "POST", headers: { "content-type": type }, body: chosen },
        );
        detail.attachments = [...detail.attachments, saved];
        renderFiles();
        uploadStatus.textContent = `Attached ${saved.name} (${formatSize(saved.size)})`;
      } catch (error) {
        uploadStatus.classList.add("is-error");
        uploadStatus.textContent = `Not attached. ${error.message}`;
      } finally {
        input.value = "";
        input.disabled = false;
      }
    });
    upload.append(uploadLabel, input, uploadStatus);

    wrap.append(
      el("h4", "evidence-title", "Attachments"),
      el(
        "p",
        "panel-muted",
        "Kept keeps attachments on the seller's side; the AI sees names and types only.",
      ),
      files,
      upload,
    );
    return wrap;
  }

  function callsFor(entry) {
    const end = Date.parse(entry.at) + CALL_SLACK_MS;
    const start = Date.parse(entry.at) - entry.paypal.durationMs - CALL_SLACK_MS;
    return calls.filter((call) => {
      const at = Date.parse(call.at);
      return call.path.includes(entry.disputeId) && at >= start && at <= end;
    });
  }

  function callsCell(entry) {
    const cell = el("td", "num");
    const linked = callsFor(entry);
    if (!linked.length) {
      cell.append(el("span", "panel-muted", "None logged"));
      return cell;
    }
    const link = el("a", "calls-link", plural(linked.length, "call"));
    link.href = "#calls";
    link.addEventListener("click", (event) => {
      event.preventDefault();
      showCalls(linked);
    });
    cell.append(link);
    return cell;
  }

  function showCalls(linked) {
    els.calls.open = true;
    const ids = new Set(linked.map((call) => `call-${call.id}`));
    let first = null;
    for (const row of els.callsScroll.querySelectorAll("tbody tr")) {
      const match = ids.has(row.id);
      row.classList.toggle("is-linked", match);
      if (match) row.setAttribute("aria-current", "true");
      else row.removeAttribute("aria-current");
      if (match && !first) first = row;
    }
    if (!first) return;
    first.scrollIntoView({ block: "center" });
    first.focus();
    announce(`Showing ${plural(linked.length, "PayPal call")} for this action`);
  }

  function renderCalls() {
    els.callsCount.textContent = calls.length
      ? plural(calls.length, "call")
      : "";
    if (!calls.length) {
      els.callsScroll.replaceChildren(
        el(
          "p",
          "calls-empty",
          "No PayPal calls recorded yet. Each request Kept makes appears here with its status and debug id.",
        ),
      );
      return;
    }
    const table = el("table", "calls-table");
    const head = el("tr");
    for (const [title, cls] of [
      ["Time", ""],
      ["Method", ""],
      ["Path", ""],
      ["Status", "num"],
      ["ms", "num"],
      ["Debug id", ""],
      ["Retried", ""],
    ]) {
      const th = el("th", cls, title);
      th.scope = "col";
      head.append(th);
    }
    table.append(el("thead"), el("tbody"));
    table.tHead.append(head);
    for (const call of [...calls].reverse()) {
      const failed = call.status === null ? Boolean(call.error) : call.status >= 400;
      const row = el("tr", failed ? "is-failed" : "");
      row.id = `call-${call.id}`;
      row.tabIndex = -1;
      const status = el(
        "td",
        "num",
        call.status === null
          ? call.error
            ? "No response"
            : "Not reported"
          : String(call.status),
      );
      if (call.error) status.title = call.error;
      row.append(
        el("td", "calls-time", callFormat.format(new Date(call.at))),
        el("td", "cell-mono", call.method),
        el("td", "cell-mono calls-path", call.path),
        status,
        el("td", "num", String(call.durationMs)),
        el("td", "cell-mono", call.debugId || "None"),
        el("td", "", call.retried ? "Yes" : "No"),
      );
      table.tBodies[0].append(row);
    }
    els.callsScroll.replaceChildren(table);
  }

  async function loadCalls() {
    try {
      calls = (await api("/api/log?kind=calls")).entries;
      renderCalls();
    } catch (error) {
      els.callsScroll.replaceChildren(
        el("p", "panel-error", `Could not load the call log. ${error.message}`),
      );
    }
  }

  function renderActivity(detail) {
    const wrap = section("Activity");
    if (!detail.actions.length) {
      wrap.append(el("p", "panel-muted", "No actions sent yet."));
      return wrap;
    }
    const table = el("table", "activity");
    const head = el("tr");
    for (const title of [
      "Time",
      "Action",
      "Amount",
      "Edited",
      "PayPal",
      "Calls",
    ])
      head.append(el("th", "", title));
    table.append(el("thead"), el("tbody"));
    table.tHead.append(head);
    for (const entry of [...detail.actions].reverse()) {
      const row = el("tr");
      const status = entry.paypal.ok
        ? `Sent${entry.paypal.status ? ` (${entry.paypal.status})` : ""}`
        : entry.paypal.status === null || entry.paypal.status >= 500
          ? "Outcome unknown"
          : `Failed (${entry.paypal.status})`;
      row.append(
        el("td", "", stampFormat.format(new Date(entry.at))),
        el("td", "", ACTION_LABELS[entry.action] || entry.action),
        el(
          "td",
          "num",
          entry.submitted.offerAmount
            ? `${detail.amount.currency_code} ${entry.submitted.offerAmount}`
            : "None",
        ),
        el("td", "", entry.sellerEdited ? "Yes" : "No"),
        el("td", entry.paypal.ok ? "" : "is-error", status),
        callsCell(entry),
      );
      table.tBodies[0].append(row);
    }
    const scroll = el("div", "activity-scroll");
    scroll.append(table);
    wrap.append(scroll);
    return wrap;
  }

  function panelState(detail) {
    const dispute = detail.dispute;
    if (!detail.open) return "resolved";
    if (
      dispute.status === "WAITING_FOR_BUYER_RESPONSE" &&
      dispute.offer?.seller_offered_amount
    )
      return "offer";
    if (
      dispute.supporting_info?.some(
        (info) => info.source === "SUBMITTED_BY_SELLER",
      )
    )
      return "review";
    if (!detail.allowed.length && !detail.sent) return "opening";
    return "action";
  }

  function stateCard(detail, state) {
    const wrap = section("Status");
    const card = el("div", `state-card state-${state}`);
    const facts = el("dl", "result-facts");
    const fact = (label, value) =>
      facts.append(el("dt", "", label), el("dd", "", value));
    const dispute = detail.dispute;
    const explanation = detail.explanation;
    if (state === "resolved") {
      card.append(el("p", "panel-lead", explanation.headline));
      if (explanation.detail)
        card.append(el("p", "panel-text", explanation.detail));
      const outcome = detail.outcome;
      if (outcome?.refunded)
        fact(
          "Refunded",
          outcome.refundedReported ? money(outcome.refunded) : "not reported",
        );
      if (outcome?.kept) fact("Kept", money(outcome.kept));
      if (outcome?.daysToClose !== null && outcome?.daysToClose !== undefined)
        fact("Closed after", plural(outcome.daysToClose, "day"));
      fact("Last update", stampFormat.format(new Date(detail.updatedAt)));
      card.append(facts);
    } else if (state === "offer") {
      const offered = dispute.offer.history
        ?.filter((event) => event.actor === "SELLER")
        .at(-1);
      card.append(
        el("p", "panel-lead", "Your offer is with the buyer"),
        el("p", "panel-text", explanation.detail),
      );
      fact("Offer", money(dispute.offer.seller_offered_amount));
      if (offered?.offer_time)
        fact("Offered", stampFormat.format(new Date(offered.offer_time)));
      if (dispute.buyer_response_due_date)
        fact(
          "Buyer answers by",
          stampFormat.format(new Date(dispute.buyer_response_due_date)),
        );
      card.append(facts);
      const sent = sentEntry(detail);
      if (sent?.submitted.note) {
        card.append(el("h4", "evidence-title", "Your note"));
        card.append(el("blockquote", "state-quote", sent.submitted.note));
      }
    } else if (state === "review") {
      const info = dispute.supporting_info
        .filter((entry) => entry.source === "SUBMITTED_BY_SELLER")
        .at(-1);
      card.append(el("p", "panel-lead", explanation.headline));
      if (explanation.detail)
        card.append(el("p", "panel-text", explanation.detail));
      if (info.provided_time) {
        fact("Sent", stampFormat.format(new Date(info.provided_time)));
        card.append(facts);
      }
      card.append(
        el("h4", "evidence-title", "What you sent"),
        el("blockquote", "state-quote", info.notes || "No note text"),
      );
    } else {
      card.append(
        el("p", "panel-lead", explanation.headline),
        el("p", "panel-text", explanation.detail),
      );
      const button = el("button", "button button-small", "Refresh");
      button.type = "button";
      button.addEventListener("click", async () => {
        button.disabled = true;
        button.replaceChildren(spinner(), document.createTextNode("Refreshing…"));
        const id = detail.disputeId;
        await Promise.all([loadPanel(id), loadCases({ refresh: true })]);
        if (panelId === id) document.getElementById("panel-status")?.focus();
      });
      const row = el("div", "panel-row state-actions");
      row.append(button);
      card.append(row);
    }
    wrap.append(card);
    return wrap;
  }

  function renderPanel(detail) {
    els.panelTitle.textContent = `Case ${panelLabel(detail)}${detail.itemName ? `: ${detail.itemName}` : ""}`;
    const state = panelState(detail);
    els.panelBody.replaceChildren(
      ...[
        renderHead(detail),
        state === "action" ? renderAsk(detail) : stateCard(detail, state),
        renderEvidence(detail),
        renderRecommendation(detail),
        ...(state === "action" ? renderDraftAndApprove(detail) : []),
        renderResult(detail),
        renderNotes(detail),
        renderActivity(detail),
      ].filter(Boolean),
    );
  }

  async function loadPanel(id) {
    try {
      const detail = await api(`/api/cases/${encodeURIComponent(id)}`);
      if (panelId !== id) return;
      panelDetail = detail;
      renderPanel(detail);
    } catch (error) {
      if (panelId !== id) return;
      els.panelBody.replaceChildren(
        el("p", "panel-error", `Could not load this case. ${error.message}`),
      );
    }
  }

  async function decideInPanel(id) {
    const pending = decide(id);
    if (panelId === id && panelDetail) renderPanel(panelDetail);
    await pending;
    if (panelId !== id) return;
    await loadPanel(id);
    document.getElementById("panel-recommendation")?.focus();
  }

  function confirmAndApprove(detail, body) {
    if (approving || els.confirmDialog.open) return;
    els.confirmSummary.textContent = `${approveLabel(body.action, detail)}${body.offerAmount ? ` (${detail.amount.currency_code} ${body.offerAmount})` : ""} for case ${panelLabel(detail)}.`;
    els.confirmDialog.returnValue = "";
    const onClose = () => {
      els.confirmDialog.removeEventListener("close", onClose);
      if (els.confirmDialog.returnValue === "ok" && !approving)
        approve(detail, body);
    };
    els.confirmDialog.addEventListener("close", onClose);
    els.confirmDialog.showModal();
  }

  async function approve(detail, body) {
    const id = detail.disputeId;
    const label = panelLabel(detail);
    approving = true;
    const button = els.panelBody.querySelector(".button-approve");
    if (button) {
      button.setAttribute("aria-disabled", "true");
      button.replaceChildren(spinner(), document.createTextNode("Sending…"));
    }
    announce(`Sending to PayPal for case ${label}`);
    try {
      const res = await authedFetch(
        `/api/cases/${encodeURIComponent(id)}/approve`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        },
      );
      const result = { status: res.status, body: await res.json() };
      if (![200, 409, 502].includes(res.status))
        throw new Error(result.body.message || `Server returned ${res.status}`);
      if (!(res.status === 409 && resultById.get(id)?.status === 200))
        resultById.set(id, result);
      if (res.status === 200) {
        const { entry, detail: fresh } = result.body;
        sentById.set(id, entry);
        gridApi.applyTransaction({ update: [fresh] });
        await loadCases({ refresh: true });
        announce(
          entry.after
            ? `Case ${label}: PayPal now reports ${entry.after.status} at ${fresh.stageLabel}`
            : `Case ${label}: sent to PayPal`,
        );
      } else if (res.status === 409) {
        announce(`Case ${label}: not sent. ${result.body.blockers.join(". ")}`);
      } else {
        announce(
          result.body.error?.unknown
            ? `Case ${label}: outcome unknown. Check PayPal before retrying.`
            : `Case ${label}: PayPal did not accept the action. ${result.body.error?.message || ""}`,
        );
      }
    } catch (error) {
      resultById.set(id, {
        status: 0,
        body: { error: { status: null, message: error.message } },
      });
      announce(
        `Case ${label}: outcome unknown. Check PayPal before retrying. ${error.message}`,
      );
    }
    approving = false;
    if (panelId !== id) return;
    await loadPanel(id);
    document.getElementById("panel-result")?.focus();
  }

  function openCase(id) {
    const node = gridApi.getRowNode(id);
    if (id !== panelId) hideCompare();
    if (els.panel.hidden) returnFocus = document.activeElement;
    panelId = id;
    panelDetail = null;
    els.panelTitle.textContent = `Case ${node.data.caseKey || shortId(id)}${node.data.itemName ? `: ${node.data.itemName}` : ""}`;
    els.panelBody.replaceChildren(
      el("p", "panel-muted", "Loading the case from PayPal…"),
    );
    els.panel.hidden = false;
    els.layout.classList.add("has-panel");
    els.panelTitle.focus();
    loadPanel(id);
  }

  function closePanel() {
    hideCompare();
    els.panel.hidden = true;
    els.layout.classList.remove("has-panel");
    panelId = null;
    panelDetail = null;
    if (returnFocus?.isConnected) returnFocus.focus();
    returnFocus = null;
  }

  // ---------- compare ----------

  const VERBS = { FIGHT: "fought", SETTLE: "settled", ACCEPT: "accepted" };

  function compareFacts(detail) {
    const facts = el("dl", "compare-facts");
    const fact = (label, value) =>
      facts.append(el("dt", "", label), el("dd", "", value));
    fact(
      "Deadline",
      !detail.open
        ? "Closed"
        : detail.dueAt
          ? `${dayFormat.format(new Date(detail.dueAt)).replace(",", "")}, ${relativeDue(detail.deadline)}`
          : "No date from PayPal",
    );
    fact("Hold", detail.hold ? money(detail.hold) : "No hold");
    const sent = sentEntry(detail);
    fact(
      "Action taken",
      sent
        ? `${ACTION_LABELS[sent.action] || sent.action}${sent.submitted.offerAmount ? ` ${detail.amount.currency_code} ${sent.submitted.offerAmount}` : ""}, ${stampFormat.format(new Date(sent.at))}`
        : "No action sent",
    );
    if (sent)
      fact(
        "PayPal after",
        sent.after
          ? `${sent.after.status} at ${sent.after.stage}${sent.after.outcome ? `, ${sent.after.outcome}` : ""}`
          : "PayPal did not answer the follow-up read",
      );
    return facts;
  }

  function compareColumn(detail) {
    const decision = detail.decision.decision;
    const column = el("article", "compare-column");
    const head = el("div", "compare-column-head");
    head.append(
      el(
        "h3",
        "compare-case",
        `Case ${panelLabel(detail)}${detail.itemName ? `: ${detail.itemName}` : ""}`,
      ),
      el(
        "span",
        `badge badge-${decision.recommendation.toLowerCase()}`,
        decision.recommendation,
      ),
    );
    column.append(
      head,
      el("p", "compare-sub", `${detail.reasonLabel} · ${money(detail.amount)}`),
      el("h4", "compare-label", "Top reasons"),
    );
    const reasons = el("ol", "compare-reasons");
    for (const reason of decision.reasons.slice(0, 3))
      reasons.append(el("li", "", reason));
    column.append(reasons);

    const evidence = el("div", "compare-evidence");
    const group = (title, cls, items, empty) => {
      const box = el("div", "");
      const heading = el("h4", `evidence-title ${cls}`, `${title} `);
      heading.append(el("span", "compare-count", String(items.length)));
      box.append(heading, list(items, empty));
      return box;
    };
    evidence.append(
      group("Evidence you have", "evidence-have", decision.evidence_have, "None listed"),
      group("Evidence missing", "evidence-missing", decision.evidence_missing, "Nothing missing"),
    );
    column.append(evidence, compareFacts(detail));
    return column;
  }

  function compareSentence(left, right) {
    const part = (detail) => {
      const decision = detail.decision.decision;
      const reason = (decision.reasons[0] || "")
        .replace(/[.\s]+$/, "")
        .replace(/^[A-Z](?=[a-z])/, (first) => first.toLowerCase());
      return `${VERBS[decision.recommendation] || decision.recommendation.toLowerCase()} ${panelLabel(detail)} because ${reason}`;
    };
    return `Kept ${part(left)} and ${part(right)}.`;
  }

  function compareEmpty(lines) {
    const box = el("div", "compare-empty");
    box.append(el("p", "compare-empty-title", "Run Kept on both cases to compare"));
    for (const line of lines) box.append(el("p", "panel-muted", line));
    els.compareBody.replaceChildren(box);
  }

  async function showCompareWith(id) {
    const left = panelDetail;
    els.compareBody.replaceChildren(
      el("p", "panel-muted", "Loading the case from PayPal…"),
    );
    try {
      const right = await api(`/api/cases/${encodeURIComponent(id)}`);
      if (els.compare.hidden || panelDetail !== left || els.compareSelect.value !== id)
        return;
      if (!right.decision) {
        compareEmpty([`Case ${panelLabel(right)} has no decision yet.`]);
        return;
      }
      const columns = el("div", "compare-columns");
      columns.append(compareColumn(left), compareColumn(right));
      els.compareBody.replaceChildren(
        columns,
        el("p", "compare-sentence", compareSentence(left, right)),
      );
    } catch (error) {
      els.compareBody.replaceChildren(
        el("p", "panel-error", `Could not load that case. ${error.message}`),
      );
    }
  }

  function openCompare(trigger) {
    const left = panelDetail;
    if (!left) return;
    compareReturn = trigger;
    const others = [];
    gridApi.forEachNode((node) => {
      if (node.data.recommendation && node.data.disputeId !== left.disputeId)
        others.push(node.data);
    });
    els.compareTitle.textContent = `Why Kept chose: case ${panelLabel(left)} side by side`;
    els.compareSelect.replaceChildren(
      ...others.map((row) => {
        const option = el(
          "option",
          "",
          `Case ${row.caseKey || shortId(row.disputeId)}${row.itemName ? `: ${row.itemName}` : ""} (${row.recommendation})`,
        );
        option.value = row.disputeId;
        return option;
      }),
    );
    const ready = Boolean(left.decision) && others.length > 0;
    els.comparePick.hidden = !ready;
    els.compare.hidden = false;
    if (ready) showCompareWith(els.compareSelect.value);
    else {
      const lines = [];
      if (!left.decision)
        lines.push(`Case ${panelLabel(left)} has no decision yet.`);
      if (!others.length) lines.push("No other case has a decision yet.");
      compareEmpty(lines);
    }
    els.compare.scrollIntoView({ block: "start" });
    els.compareTitle.focus();
  }

  function hideCompare() {
    els.compare.hidden = true;
    els.compareBody.replaceChildren();
  }

  function closeCompare() {
    hideCompare();
    if (compareReturn?.isConnected) compareReturn.focus();
    else els.panelTitle.focus();
    compareReturn = null;
  }

  // ---------- policy ----------

  const POLICY_FIELDS = {
    maxOfferPercent: "policy-percent",
    maxOfferAbsolute: "policy-absolute",
    deadlineBufferHours: "policy-buffer",
  };

  function setFieldError(name, message) {
    const id = POLICY_FIELDS[name];
    const error = document.getElementById(`${id}-error`);
    error.textContent = message;
    error.hidden = !message;
    document
      .getElementById(id)
      .setAttribute("aria-invalid", String(Boolean(message)));
  }

  function clearPolicyErrors() {
    for (const name of Object.keys(POLICY_FIELDS)) setFieldError(name, "");
    els.policyError.hidden = true;
    els.policyError.textContent = "";
  }

  function issueText(name, issue) {
    if (issue.code === "too_big") return `Must be ${issue.maximum} or less`;
    if (issue.code === "too_small") return `Must be ${issue.minimum} or more`;
    if (name === "maxOfferAbsolute") return "Enter an amount like 50.00";
    if (issue.code === "invalid_type") return "Enter a whole number";
    return issue.message;
  }

  async function openPolicy() {
    if (els.policyDialog.open) return;
    clearPolicyErrors();
    els.policySave.disabled = false;
    try {
      const policy = await api("/api/policy");
      for (const [name, id] of Object.entries(POLICY_FIELDS))
        document.getElementById(id).value = String(policy[name]);
    } catch (error) {
      els.policyError.textContent = `Could not load the current policy. ${error.message}`;
      els.policyError.hidden = false;
    }
    els.policyDialog.showModal();
    document.getElementById(POLICY_FIELDS.maxOfferPercent).focus();
  }

  function panelHasEdits() {
    return [...els.panelBody.querySelectorAll("textarea, input:not([type=file])")].some(
      (field) => field.value !== field.defaultValue,
    );
  }

  async function savePolicy(event) {
    event.preventDefault();
    clearPolicyErrors();
    const read = (name) =>
      document.getElementById(POLICY_FIELDS[name]).value.trim();
    const number = (text) =>
      /^-?\d+(\.\d+)?$/.test(text) ? Number(text) : text;
    const body = {
      maxOfferPercent: number(read("maxOfferPercent")),
      maxOfferAbsolute: read("maxOfferAbsolute"),
      deadlineBufferHours: number(read("deadlineBufferHours")),
    };
    els.policySave.disabled = true;
    try {
      const res = await authedFetch("/api/policy", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const result = await res.json();
      if (res.status === 400 && Array.isArray(result.issues)) {
        const invalid = [];
        for (const issue of result.issues) {
          const name = issue.path[0];
          if (!(name in POLICY_FIELDS) || invalid.includes(name)) continue;
          setFieldError(name, issueText(name, issue));
          invalid.push(name);
        }
        if (invalid.length)
          document.getElementById(POLICY_FIELDS[invalid[0]]).focus();
        else {
          els.policyError.textContent = "Not saved. Check the values.";
          els.policyError.hidden = false;
        }
        announce(`Policy not saved. ${plural(invalid.length, "field")} need attention.`);
        return;
      }
      if (!res.ok)
        throw new Error(result.message || `Server returned ${res.status}`);
      els.policyDialog.close();
      announce(
        `Policy saved: offers up to ${result.maxOfferPercent}% or ${result.maxOfferAbsolute}, due soon inside ${plural(result.deadlineBufferHours, "hour")}`,
      );
      await loadCases();
      if (panelId && !panelHasEdits()) loadPanel(panelId);
    } catch (error) {
      els.policyError.textContent = `Not saved. ${error.message}`;
      els.policyError.hidden = false;
    } finally {
      els.policySave.disabled = false;
    }
  }

  // ---------- grid ----------

  function moneyColumn(field, headerName, read, extra) {
    return {
      colId: field,
      headerName,
      type: "rightAligned",
      minWidth: 96,
      valueGetter: (p) => toCents(read(p.data)),
      valueFormatter: (p) => money(read(p.data)),
      getQuickFilterText: (p) => money(read(p.data)),
      filter: "agNumberColumnFilter",
      filterValueGetter: (p) => toCents(read(p.data)),
      ...extra,
    };
  }

  function dueComparator(a, b, nodeA, nodeB, isDescending) {
    if (a === null && b === null) {
      const order =
        nodeA.data.open !== nodeB.data.open
          ? nodeA.data.open
            ? -1
            : 1
          : Date.parse(nodeB.data.updatedAt) - Date.parse(nodeA.data.updatedAt);
      return isDescending ? -order : order;
    }
    if (a === null) return isDescending ? -1 : 1;
    if (b === null) return isDescending ? 1 : -1;
    return a.getTime() - b.getTime();
  }

  const columnDefs = [
    {
      colId: "case",
      headerName: "Case",
      pinned: "left",
      minWidth: 120,
      valueGetter: (p) =>
        p.node.rowPinned
          ? "Total"
          : `${p.data.caseKey || ""} ${p.data.disputeId}`.trim(),
      cellRenderer: caseCell,
    },
    {
      colId: "item",
      headerName: "Item",
      field: "itemName",
      minWidth: 110,
      tooltipField: "itemName",
    },
    {
      colId: "reason",
      headerName: "Buyer reason",
      field: "reasonLabel",
      minWidth: 110,
      filter: "agTextColumnFilter",
    },
    moneyColumn("amount", "Amount", (d) => d.amount),
    { colId: "stage", headerName: "Stage", field: "stageLabel", minWidth: 100 },
    {
      colId: "status",
      headerName: "Status",
      minWidth: 150,
      valueGetter: (p) =>
        p.node.rowPinned ? "" : `${statusChip(p.data).text} ${p.data.headline}`,
      cellRenderer: statusCell,
      tooltipValueGetter: (p) => (p.node.rowPinned ? null : p.data.headline),
    },
    {
      colId: "due",
      headerName: "Seller response due",
      minWidth: 180,
      sort: "asc",
      valueGetter: (p) =>
        p.node.rowPinned || !p.data.dueAt ? null : new Date(p.data.dueAt),
      getQuickFilterText: (p) =>
        p.data.dueAt
          ? `${dayFormat.format(new Date(p.data.dueAt)).replace(",", "")} ${p.data.deadline.state === "due_soon" ? "due soon" : ""}`
          : "",
      comparator: dueComparator,
      filter: "agDateColumnFilter",
      cellRenderer: dueCell,
    },
    moneyColumn("hold", "Hold", (d) => d.hold, {
      tooltipValueGetter: (p) =>
        p.node.rowPinned
          ? "Total PayPal is holding on open cases"
          : p.data.hold
            ? "PayPal is holding this amount for the case"
            : null,
    }),
    {
      colId: "recommendation",
      headerName: "Recommendation",
      minWidth: 175,
      valueGetter: (p) => (p.node.rowPinned ? "" : p.data.recommendation || ""),
      cellRenderer: recommendationCell,
      tooltipValueGetter: (p) => {
        if (p.node.rowPinned) return null;
        const row = p.data;
        if (row.recommendationStale && row.staleReason)
          return `This case changed since Kept looked: ${row.staleReason}`;
        if (row.recommendation)
          return (
            reasonsById.get(row.disputeId) ||
            "Open the case to read the reasons"
          );
        const failed = decideState.get(row.disputeId);
        return failed?.state === "failed" ? failed.detail : null;
      },
    },
    {
      colId: "action",
      headerName: "Action",
      minWidth: 100,
      valueGetter: (p) => (p.node.rowPinned ? "" : actionText(p.data)),
    },
    moneyColumn("kept", "Kept", (d) => d.outcome?.kept ?? null, {
      tooltipValueGetter: (p) =>
        p.node.rowPinned
          ? "Total kept after resolution"
          : p.data.outcome?.kept
            ? p.data.outcome.refundedReported
              ? "disputed_transactions[0].gross_amount minus what PayPal refunded"
              : "disputed_transactions[0].gross_amount; PayPal reported no refund, counted as 0.00"
            : null,
    }),
  ];

  function createGrid() {
    gridApi = agGrid.createGrid(els.grid, {
      theme: agGrid.themeQuartz.withParams({
        accentColor: "#2b4fb8",
        fontFamily:
          'system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
        fontSize: 14,
        foregroundColor: "#18181b",
        borderColor: "#e4e4e7",
        headerBackgroundColor: "#fafafa",
        headerTextColor: "#3f3f46",
        headerFontWeight: 600,
        rowHoverColor: "#f4f4f5",
        selectedRowBackgroundColor: "#eef2fb",
        wrapperBorderRadius: 8,
        cellHorizontalPadding: 12,
        browserColorScheme: "light",
      }),
      columnDefs,
      defaultColDef: {
        sortable: true,
        resizable: true,
        filter: true,
        suppressMovable: true,
        wrapHeaderText: true,
        autoHeaderHeight: true,
      },
      loading: true,
      animateRows: !matchMedia("(prefers-reduced-motion: reduce)").matches,
      rowHeight: 56,
      getRowId: (p) => p.data.disputeId,
      postSortRows: (p) => {
        const resolved = p.nodes.filter((node) => !node.data.open);
        if (!resolved.length) return;
        const open = p.nodes.filter((node) => node.data.open);
        p.nodes.splice(0, p.nodes.length, ...open, ...resolved);
      },
      rowClassRules: {
        "row-due-soon": (p) =>
          !p.node.rowPinned && p.data.deadline.state === "due_soon",
        "row-resolved": (p) => !p.node.rowPinned && !p.data.open,
        "row-total": (p) => Boolean(p.node.rowPinned),
      },
      rowSelection: {
        mode: "singleRow",
        checkboxes: false,
        enableClickSelection: true,
        isRowSelectable: (node) => !node.rowPinned,
      },
      overlayNoRowsTemplate:
        "<span>No open disputes. Refresh, or seed a new set (docs/seeding.md).</span>",
      overlayLoadingTemplate: "<span>Loading cases from PayPal…</span>",
      domLayout: "autoHeight",
      enableCellTextSelection: true,
      tooltipShowDelay: 300,
      autoSizeStrategy: { type: "fitGridWidth", defaultMinWidth: 110 },
      onGridSizeChanged: (p) => {
        if (p.clientWidth > 0) p.api.sizeColumnsToFit();
      },
      onRowClicked: (p) => {
        if (p.node.rowPinned) return;
        if (
          p.event?.target instanceof Element &&
          p.event.target.closest("button")
        )
          return;
        openCase(p.data.disputeId);
      },
      onCellKeyDown: (p) => {
        if (p.event?.key !== "Enter" || p.node.rowPinned) return;
        if (
          p.event.target instanceof Element &&
          p.event.target.closest("button")
        )
          return;
        if (
          p.column.getColId() === "recommendation" &&
          !p.data.recommendation &&
          p.data.open
        ) {
          decide(p.data.disputeId);
          return;
        }
        openCase(p.data.disputeId);
      },
    });
    els.grid.querySelector('[role="grid"]').setAttribute("aria-label", "Disputes");
  }

  function renderGrid(rows) {
    const tall = rows.length >= AUTO_HEIGHT_LIMIT;
    els.gridFrame.classList.toggle("is-tall", tall);
    els.gridFrame.classList.toggle("has-rows", rows.length > 0);
    gridApi.setGridOption("domLayout", tall ? "normal" : "autoHeight");
    gridApi.setGridOption("rowData", rows);
  }

  async function loadCases({ refresh } = {}) {
    gridApi.setGridOption("loading", true);
    els.refresh.disabled = true;
    const callsLoaded = loadCalls();
    try {
      const [data, log] = await Promise.all([
        api(`/api/cases${refresh ? "?refresh=1" : ""}`),
        api("/api/log?kind=actions"),
      ]);
      sentById.clear();
      for (const entry of log.entries)
        if (entry.paypal.ok) sentById.set(entry.disputeId, entry);
      renderGrid(data.cases);
      gridApi.setGridOption(
        "pinnedBottomRowData",
        data.cases.length ? [totalRow(data.summary)] : [],
      );
      renderSummary(data.summary);
      const when = timeFormat.format(new Date(data.fetchedAt));
      els.fetchStatus.classList.toggle("is-warning", data.stale);
      els.fetchStatus.textContent = data.stale
        ? `PayPal did not answer, showing the list from ${when}. ${data.warning || ""}`.trim()
        : `${plural(data.cases.length, "case")} from PayPal, updated ${when}`;
      if (refresh) announce(`Refreshed. ${plural(data.cases.length, "case")}.`);
      schedulePoll();
    } catch (error) {
      els.fetchStatus.classList.add("is-warning");
      els.fetchStatus.textContent = `Could not load cases. ${error.message}`;
      announce(`Could not load cases. ${error.message}`);
    } finally {
      gridApi.setGridOption("loading", false);
      els.refresh.disabled = false;
    }
    await callsLoaded;
  }

  async function loadFooter() {
    const res = await fetch("/healthz");
    const health = await res.json();
    const snapshot = health.restoredFrom
      ? `; decisions and the action log are restored from the snapshot recorded ${stampFormat.format(new Date(health.restoredFrom))}`
      : "";
    if (health.mode === "replay") {
      replay = true;
      els.replayBanner.textContent = `Replay of recorded sandbox data from ${recordedFormat.format(new Date(health.recordedOn))}. Actions here are simulated.`;
      els.replayBanner.hidden = false;
      els.confirmText.textContent =
        "Replay: this simulates a sandbox action. Nothing is sent to PayPal. Continue?";
    }
    els.footer.textContent = `Demo state resets to the seed when the server restarts (Render free tier keeps no disk)${snapshot}. Started ${stampFormat.format(new Date(health.startedAt))}. Sandbox only.`;
  }

  // ---------- wiring ----------

  els.passcodeForm.addEventListener("submit", () => {
    els.dialog.returnValue = "ok";
  });
  els.quickFilter.addEventListener("input", () =>
    gridApi.setGridOption("quickFilterText", els.quickFilter.value),
  );
  els.refresh.addEventListener("click", () => loadCases({ refresh: true }));
  els.decideAll.addEventListener("click", decideAll);
  els.policyButton.addEventListener("click", openPolicy);
  els.compareClose.addEventListener("click", closeCompare);
  els.compareSelect.addEventListener("change", () =>
    showCompareWith(els.compareSelect.value),
  );
  els.policyForm.addEventListener("submit", savePolicy);
  els.policyCancel.addEventListener("click", () => els.policyDialog.close());
  els.panelClose.addEventListener("click", closePanel);
  document.addEventListener("keydown", (event) => {
    if (
      event.key !== "Escape" ||
      els.panel.hidden ||
      els.dialog.open ||
      els.confirmDialog.open ||
      els.policyDialog.open
    )
      return;
    const active = document.activeElement;
    if (!els.compare.hidden && els.compare.contains(active)) {
      closeCompare();
      return;
    }
    if (
      (active instanceof HTMLTextAreaElement ||
        active instanceof HTMLInputElement) &&
      els.panel.contains(active) &&
      active.value !== active.defaultValue
    )
      return;
    closePanel();
  });

  createGrid();
  loadFooter().catch((error) => {
    els.footer.textContent = `Sandbox only. Server status unavailable: ${error.message}`;
  });
  loadCases();

  window.kept = { api, loadCases, renderGrid, openCase, announce };
})();
