/**
 * Backtesting-analysis — parity with freqtrade's `backtesting-analysis`
 * command (five grouping levels + enter/exit reason filters).
 *
 * Grouping levels:
 *   0: by pair                                     (symbol)
 *   1: by enter_tag                                (we use `strategy` as the tag)
 *   2: by exit_reason                              (trade.reason)
 *   3: by pair × enter_tag
 *   4: by pair × exit_reason
 *   5: by pair × enter_tag × exit_reason
 *
 * Input is any array of trade-like rows with { symbol, strategy, reason, pnl }.
 * Works on both AutoTraderTrade rows and on trades returned by a backtest
 * run — the shape is the same.
 */

function summarize(rows) {
  const trades = rows.length;
  if (!trades) return { trades: 0, wins: 0, losses: 0, winRate: 0, totalPnl: 0, avgPnl: 0, bestPnl: 0, worstPnl: 0 };
  let wins = 0, losses = 0, total = 0, best = -Infinity, worst = Infinity;
  for (const r of rows) {
    const pnl = Number(r.pnl) || 0;
    total += pnl;
    if (pnl > 0) wins++; else losses++;
    if (pnl > best) best = pnl;
    if (pnl < worst) worst = pnl;
  }
  return {
    trades, wins, losses,
    winRate: Math.round((wins / trades) * 10000) / 100,
    totalPnl: Math.round(total * 100) / 100,
    avgPnl:   Math.round((total / trades) * 100) / 100,
    bestPnl:  Math.round(best * 100) / 100,
    worstPnl: Math.round(worst * 100) / 100,
  };
}

function groupBy(rows, keyFn) {
  const out = new Map();
  for (const r of rows) {
    const k = keyFn(r);
    if (!out.has(k)) out.set(k, []);
    out.get(k).push(r);
  }
  return out;
}

/**
 * Normalize a trade row. AutoTraderTrade uses `symbol`, backtest-engine
 * trades don't carry symbol (they're per-run), so callers must pre-stamp
 * it. We accept both.
 */
function normalize(r, fallbackSymbol = null) {
  return {
    symbol:   r.symbol   || fallbackSymbol || '(unknown)',
    enterTag: r.enterTag || r.strategy || '(untagged)',
    exitReason: r.exitReason || r.reason || '(unspecified)',
    pnl: Number(r.pnl) || 0,
  };
}

export function analyze(trades, options = {}) {
  const {
    group = 0,
    enterReasonList = null,   // array of enter_tag values to keep
    exitReasonList = null,    // array of exit_reason values to keep
    fallbackSymbol = null,
  } = options;

  let rows = trades.map((t) => normalize(t, fallbackSymbol));

  if (Array.isArray(enterReasonList) && enterReasonList.length) {
    const keep = new Set(enterReasonList);
    rows = rows.filter((r) => keep.has(r.enterTag));
  }
  if (Array.isArray(exitReasonList) && exitReasonList.length) {
    const keep = new Set(exitReasonList);
    rows = rows.filter((r) => keep.has(r.exitReason));
  }

  const keyFn = (() => {
    switch (Number(group)) {
      case 0: return (r) => r.symbol;
      case 1: return (r) => r.enterTag;
      case 2: return (r) => r.exitReason;
      case 3: return (r) => `${r.symbol} • ${r.enterTag}`;
      case 4: return (r) => `${r.symbol} • ${r.exitReason}`;
      case 5: return (r) => `${r.symbol} • ${r.enterTag} • ${r.exitReason}`;
      default: throw new Error(`group must be 0..5 (got ${group})`);
    }
  })();

  const groups = groupBy(rows, keyFn);
  const entries = [];
  for (const [k, subset] of groups) {
    entries.push({ key: k, ...summarize(subset) });
  }
  // Sort by totalPnl descending — best first.
  entries.sort((a, b) => b.totalPnl - a.totalPnl);

  return {
    group: Number(group),
    totalRowsConsidered: rows.length,
    filtersApplied: {
      enterReasonList: enterReasonList || null,
      exitReasonList: exitReasonList || null,
    },
    overall: summarize(rows),
    groups: entries,
  };
}
