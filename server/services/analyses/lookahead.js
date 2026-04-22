import { runStrategy } from '../strategyEngine.js';

/**
 * Lookahead analysis — detects whether a strategy's historical signals are
 * contaminated by future data (a "lookahead bias").
 *
 * How it works: we run the strategy on the full bar set to get the baseline
 * signal sequence, then we run it repeatedly on progressively truncated slices
 * (bars[0..N], bars[0..N+step], …). For a well-formed strategy, the signal at
 * bar i should only depend on bars[0..i] — so appending more bars later must
 * NOT change any prior signal. Any mismatch at index i < truncationLength is
 * evidence that the strategy peeked ahead.
 *
 * Based on freqtrade's lookahead_analysis concept.
 */

export function lookaheadAnalysis(strategyKey, bars, { stride = 25, minBars = 100 } = {}) {
  if (!Array.isArray(bars) || bars.length < minBars + stride) {
    throw new Error(`Need at least ${minBars + stride} bars; got ${bars?.length || 0}`);
  }

  // Baseline = signals on the full history. We compare every truncated run
  // against this. Using a Map keyed by bar.time is resilient to index drift
  // if a strategy produced more/fewer signals at a given slice.
  const baselineSignals = runStrategy(strategyKey, bars);
  const baselineByTime = new Map();
  for (const s of baselineSignals) baselineByTime.set(s.time, s);

  const mismatches = [];
  let checkedSlices = 0;
  let checkedSignals = 0;

  for (let cutoff = minBars; cutoff < bars.length; cutoff += stride) {
    const slice = bars.slice(0, cutoff);
    const sliced = runStrategy(strategyKey, slice);
    checkedSlices += 1;

    // Compare every signal emitted in this truncated run with the baseline.
    // Those signals were produced from only bars[0..cutoff], so if the
    // baseline disagrees at the same timestamp the strategy changed its mind
    // after seeing more data → lookahead bias.
    for (const sig of sliced) {
      checkedSignals += 1;
      const base = baselineByTime.get(sig.time);
      if (!base) {
        mismatches.push({
          time: sig.time, cutoff,
          kind: 'disappeared',
          detail: `slice produced a ${sig.action} signal that the full run does not emit`,
          sliced: sig.action, baseline: null,
        });
        continue;
      }
      if (base.action !== sig.action) {
        mismatches.push({
          time: sig.time, cutoff,
          kind: 'flipped',
          detail: `action changed between slice and full run`,
          sliced: sig.action, baseline: base.action,
        });
      }
    }
  }

  // "Clean" = every truncated slice agrees with the full-history run, which
  // is the invariant a causal strategy must satisfy.
  return {
    strategyKey,
    barsAnalyzed: bars.length,
    stride,
    checkedSlices,
    checkedSignals,
    mismatchCount: mismatches.length,
    clean: mismatches.length === 0,
    // Cap the sample so the response stays small on pathological strategies.
    mismatches: mismatches.slice(0, 50),
  };
}
