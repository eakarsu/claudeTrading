/**
 * Leverage helpers — compute liquidation prices and margin ratios.
 *
 * This is freqtrade-parity math, not a full margin-account simulation. The
 * formulas ignore funding fees, maintenance-margin tiers, and ADL — they're
 * good enough for UI displays and post-trade analysis, not for a real
 * liquidation engine. Real margin accounting lives on the exchange.
 *
 *   isolated-margin liquidation price (long):
 *       entry * (1 - 1/leverage + maintenanceMargin)
 *   isolated-margin liquidation price (short):
 *       entry * (1 + 1/leverage - maintenanceMargin)
 */

const DEFAULT_MAINT_MARGIN = 0.005; // 0.5% — conservative default

export function liquidationPrice({ entry, leverage, side = 'long', marginMode = 'isolated', maintenanceMargin = DEFAULT_MAINT_MARGIN }) {
  if (!Number.isFinite(entry) || entry <= 0) return null;
  const lev = Math.max(1, Number(leverage) || 1);
  if (lev <= 1 || marginMode === 'spot') return null; // cash trade — no liquidation
  const mm = Number(maintenanceMargin) || DEFAULT_MAINT_MARGIN;
  if (side === 'short') return entry * (1 + 1 / lev - mm);
  return entry * (1 - 1 / lev + mm);
}

export function marginRequired({ entry, qty, leverage }) {
  const lev = Math.max(1, Number(leverage) || 1);
  if (!Number.isFinite(entry) || !Number.isFinite(qty)) return 0;
  return (entry * qty) / lev;
}

/**
 * Unrealized P&L accounting for leverage. Same as spot long/short P&L but
 * expressed as % of posted margin (what the user actually risks).
 */
export function unrealizedPnlPct({ entry, current, leverage, side = 'long' }) {
  if (!Number.isFinite(entry) || !Number.isFinite(current) || entry <= 0) return 0;
  const lev = Math.max(1, Number(leverage) || 1);
  const raw = side === 'short' ? (entry - current) / entry : (current - entry) / entry;
  return raw * lev;
}

export function isLiquidated({ entry, current, leverage, side = 'long', marginMode = 'isolated', maintenanceMargin = DEFAULT_MAINT_MARGIN }) {
  const liq = liquidationPrice({ entry, leverage, side, marginMode, maintenanceMargin });
  if (liq == null) return false;
  return side === 'short' ? current >= liq : current <= liq;
}
