"use strict";

(() => {
  const PASSCODE_KEY = "settle.passcode";
  const AUTO_HEIGHT_LIMIT = 20;
  const TOTAL_ID = "__total__";

  const els = {
    layout: document.getElementById("layout"),
    grid: document.getElementById("grid"),
    gridFrame: document.getElementById("grid-frame"),
    strip: document.getElementById("summary-strip"),
    fetchStatus: document.getElementById("fetch-status"),
    quickFilter: document.getElementById("quick-filter"),
    refresh: document.getElementById("refresh-button"),
    footer: document.getElementById("footer"),
    announcer: document.getElementById("announcer"),
    panel: document.getElementById("panel"),
    panelTitle: document.getElementById("panel-title"),
    panelHeadline: document.getElementById("panel-headline"),
    panelClose: document.getElementById("panel-close"),
    dialog: document.getElementById("passcode-dialog"),
    passcodeForm: document.getElementById("passcode-form"),
    passcodeInput: document.getElementById("passcode-input"),
    passcodeError: document.getElementById("passcode-error"),
  };

  let gridApi = null;
  let summaryText = null;
  let passcodePrompt = null;
  const reasonsById = new Map();
  const decideState = new Map();
  const sentById = new Map();

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
  const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;

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
    if (row.status === "WAITING_FOR_BUYER_RESPONSE")
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

  async function api(path, init = {}) {
    const send = () => {
      const headers = new Headers(init.headers);
      const code = sessionStorage.getItem(PASSCODE_KEY);
      if (code) headers.set("x-settle-passcode", code);
      return fetch(path, { ...init, headers });
    };
    let res = await send();
    while (res.status === 401) {
      const hadCode = sessionStorage.getItem(PASSCODE_KEY) !== null;
      sessionStorage.removeItem(PASSCODE_KEY);
      await askPasscode(hadCode);
      res = await send();
    }
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
        "Counts disputes whose PayPal status is RESOLVED",
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
          "dispute_amount minus dispute_outcome.amount_refunded, on resolved cases",
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
    const state = decideState.get(row.disputeId);
    const button = el(
      "button",
      "button button-small",
      state?.state === "running"
        ? "Deciding…"
        : state?.state === "failed"
          ? "Retry"
          : "Decide",
    );
    button.type = "button";
    button.disabled = state?.state === "running";
    button.setAttribute(
      "aria-label",
      `Decide case ${row.caseKey || shortId(row.disputeId)}`,
    );
    button.addEventListener("click", (event) => {
      event.stopPropagation();
      decide(row.disputeId);
    });
    wrap.append(button);
    if (state?.state === "failed")
      wrap.append(el("span", "decide-error", "No decision yet"));
    return wrap;
  }

  // ---------- decide in place ----------

  async function decide(id) {
    if (decideState.get(id)?.state === "running") return;
    const node = gridApi.getRowNode(id);
    const label = node.data.caseKey || shortId(id);
    decideState.set(id, { state: "running" });
    gridApi.refreshCells({
      rowNodes: [node],
      columns: ["recommendation"],
      force: true,
    });
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
      announce(
        `Case ${label}: Settle recommends ${result.decision.recommendation}`,
      );
    } catch (error) {
      decideState.set(id, { state: "failed", detail: error.message });
      gridApi.refreshCells({
        rowNodes: [gridApi.getRowNode(id)],
        columns: ["recommendation"],
        force: true,
      });
      announce(`Case ${label}: no decision yet. ${error.message}`);
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
      return (
        Date.parse(nodeB.data.updatedAt) - Date.parse(nodeA.data.updatedAt)
      );
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
      minWidth: 140,
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
          return `This case changed since Settle looked: ${row.staleReason}`;
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
            ? "Disputed amount minus what PayPal refunded"
            : null,
    }),
  ];

  function openCase(id) {
    const node = gridApi.getRowNode(id);
    console.log("openCase", id);
    els.panelTitle.textContent = `Case ${node.data.caseKey || shortId(id)}${node.data.itemName ? `: ${node.data.itemName}` : ""}`;
    els.panelHeadline.textContent = node.data.headline;
    els.panel.hidden = false;
    els.layout.classList.add("has-panel");
  }

  function closePanel() {
    els.panel.hidden = true;
    els.layout.classList.remove("has-panel");
  }

  function createGrid() {
    gridApi = agGrid.createGrid(els.grid, {
      theme: agGrid.themeQuartz.withParams({
        accentColor: "#2b4fb8",
        fontFamily: "system-ui, -apple-system, \"Segoe UI\", Roboto, \"Helvetica Neue\", Arial, sans-serif",
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
      rowHeight: 56,
      getRowId: (p) => p.data.disputeId,
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
    } catch (error) {
      els.fetchStatus.classList.add("is-warning");
      els.fetchStatus.textContent = `Could not load cases. ${error.message}`;
      announce(`Could not load cases. ${error.message}`);
    } finally {
      gridApi.setGridOption("loading", false);
      els.refresh.disabled = false;
    }
  }

  async function loadFooter() {
    const res = await fetch("/healthz");
    const health = await res.json();
    const snapshot = health.restoredFrom
      ? `; decisions and the action log are restored from the snapshot recorded ${stampFormat.format(new Date(health.restoredFrom))}`
      : "";
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
  els.panelClose.addEventListener("click", closePanel);

  createGrid();
  loadFooter().catch((error) => {
    els.footer.textContent = `Sandbox only. Server status unavailable: ${error.message}`;
  });
  loadCases();

  window.settle = { api, loadCases, renderGrid, openCase, announce };
})();
