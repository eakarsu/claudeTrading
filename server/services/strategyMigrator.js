/**
 * Strategy Migration V2 → V3.
 *
 * Freqtrade V3 renamed several hook methods, parameters, and column names.
 * This transformer applies the regex/string rewrites described in the
 * freqtrade V3 migration guide. It is NOT a full AST transform — it's a
 * pragmatic text-level rewriter that handles the common 90% of cases and
 * reports anything it can't confidently migrate.
 *
 * Documented rewrites:
 *   populate_buy_trend           → populate_entry_trend
 *   populate_sell_trend          → populate_exit_trend
 *   'buy' column                 → 'enter_long'
 *   'sell' column                → 'exit_long'
 *   'buy_tag' column             → 'enter_tag'
 *   check_buy_timeout            → check_entry_timeout
 *   check_sell_timeout           → check_exit_timeout
 *   custom_sell                  → custom_exit
 *   confirm_trade_exit(…sell_reason…) → confirm_trade_exit(…exit_reason…)
 *   minimal_roi keys stay the same, but order_types 'sell' → 'exit'
 *   use_sell_signal              → use_exit_signal
 *   sell_profit_only             → exit_profit_only
 *   ignore_roi_if_buy_signal     → ignore_roi_if_entry_signal
 *   INTERFACE_VERSION = 2        → INTERFACE_VERSION = 3
 */

const RULES = [
  { find: /\bpopulate_buy_trend\b/g,          replace: 'populate_entry_trend' },
  { find: /\bpopulate_sell_trend\b/g,         replace: 'populate_exit_trend' },
  { find: /\bcheck_buy_timeout\b/g,           replace: 'check_entry_timeout' },
  { find: /\bcheck_sell_timeout\b/g,          replace: 'check_exit_timeout' },
  { find: /\bcustom_sell\b/g,                 replace: 'custom_exit' },
  { find: /\buse_sell_signal\b/g,             replace: 'use_exit_signal' },
  { find: /\bsell_profit_only\b/g,            replace: 'exit_profit_only' },
  { find: /\bsell_profit_offset\b/g,          replace: 'exit_profit_offset' },
  { find: /\bignore_roi_if_buy_signal\b/g,    replace: 'ignore_roi_if_entry_signal' },
  { find: /\bsell_reason\b/g,                 replace: 'exit_reason' },
  { find: /\bbuy_tag\b/g,                     replace: 'enter_tag' },
  // DataFrame column writes: dataframe.loc[…, 'buy'] = 1  →  'enter_long'
  { find: /(['"])buy\1(\s*\])/g,              replace: "'enter_long'$2" },
  { find: /(['"])sell\1(\s*\])/g,             replace: "'exit_long'$2" },
  // order_types keys: 'buy': ... → 'entry': ... ; 'sell': ... → 'exit': ...
  { find: /(['"])buy\1(\s*:)/g,               replace: "'entry'$2" },
  { find: /(['"])sell\1(\s*:)/g,              replace: "'exit'$2" },
  // Interface version bump
  { find: /INTERFACE_VERSION\s*=\s*2\b/g,     replace: 'INTERFACE_VERSION = 3' },
];

// Lines we flag as "likely needs manual review" even though we don't rewrite
// them — these are V3 changes that require judgment.
const WARNINGS = [
  { pattern: /\bIStrategy\b.*:.*/, note: 'Verify class still inherits IStrategy — V3 signature for populate_* is unchanged but hooks like custom_exit() now return Optional[str|bool].' },
  { pattern: /\bticker_interval\b/, note: '`ticker_interval` was deprecated in V2 and removed in V3 — use `timeframe`.' },
  { pattern: /\bstoploss_on_exchange\b/, note: 'Re-check stoploss_on_exchange semantics — V3 changed when the exchange-side stop is placed.' },
  { pattern: /\bprotections\s*=\s*\[/, note: 'Per-strategy protections list is still supported but consider moving to @property protections in V3.' },
];

/**
 * Migrate V2 strategy source to V3.
 * @param {string} source — Python source text
 * @returns {{migrated: string, changes: Array<{rule:string, count:number}>, warnings: Array<{line:number, note:string, text:string}>}}
 */
export function migrateV2ToV3(source) {
  if (typeof source !== 'string') throw new Error('source must be a string');

  let out = source;
  const changes = [];
  for (const { find, replace } of RULES) {
    const matches = out.match(find);
    if (matches) {
      out = out.replace(find, replace);
      changes.push({ rule: find.source, count: matches.length });
    }
  }

  const warnings = [];
  const lines = out.split('\n');
  for (let i = 0; i < lines.length; i++) {
    for (const { pattern, note } of WARNINGS) {
      if (pattern.test(lines[i])) {
        warnings.push({ line: i + 1, note, text: lines[i].trim() });
      }
    }
  }

  return { migrated: out, changes, warnings };
}
