import { computeAll } from './indicators.js';

/**
 * FreqAI-lite — a minimal ML signal layer that trains a logistic regression
 * on indicator features to predict whether the next bar's close will be
 * higher than this bar's close.
 *
 * This is the simplest possible stand-in for freqtrade's FreqAI module. The
 * full module supports XGBoost, LightGBM, PyTorch, model persistence, and
 * walk-forward retraining; this is a lightweight analog meant to demonstrate
 * the pattern — train features → predict probability → gate signals.
 *
 * Model: binary logistic regression with L2 regularization, trained by
 * batch gradient descent. No external dependencies.
 *
 * Features (computed per-bar from existing indicators):
 *   - RSI (0..100 scale → centered to 0..1)
 *   - MACD histogram (sign + magnitude, normalized by price)
 *   - ADX (trend strength)
 *   - Close vs SMA20 (percent deviation)
 *   - Close vs SMA50 (percent deviation)
 *   - 5-bar return
 *   - Volume z-score over 20 bars
 */

const FEATURE_NAMES = [
  'rsi_norm', 'macd_hist', 'adx_norm', 'sma20_dev', 'sma50_dev', 'ret5', 'vol_z',
];

function featurize(bars) {
  const n = bars.length;
  const ind = computeAll(bars);
  const rows = [];

  // Precompute 20-bar rolling mean/std of volume for the vol_z feature.
  const vols = bars.map((b) => Number(b.volume) || 0);
  const volMeans = Array(n).fill(0);
  const volStds  = Array(n).fill(0);
  for (let i = 0; i < n; i++) {
    const s = Math.max(0, i - 19);
    const slice = vols.slice(s, i + 1);
    const m = slice.reduce((a, b) => a + b, 0) / slice.length;
    const v = slice.reduce((a, b) => a + (b - m) ** 2, 0) / slice.length;
    volMeans[i] = m;
    volStds[i] = Math.sqrt(v);
  }

  for (let i = 0; i < n; i++) {
    const close = bars[i].close;
    const rsi = ind.rsi?.[i];
    const macd = ind.macd?.[i];      // { macd, signal, hist }
    const adx = ind.adx?.[i];
    const sma20 = ind.sma20?.[i];
    const sma50 = ind.sma50?.[i];

    // Feature availability: skip bars with insufficient warmup.
    if (!Number.isFinite(rsi) || !Number.isFinite(adx) || !Number.isFinite(sma20) || !Number.isFinite(sma50) || i < 5) {
      rows.push(null);
      continue;
    }

    const macdHistNorm = macd && Number.isFinite(macd.hist) && close
      ? macd.hist / close
      : 0;
    const sma20Dev = sma20 ? (close - sma20) / sma20 : 0;
    const sma50Dev = sma50 ? (close - sma50) / sma50 : 0;
    const ret5 = bars[i - 5].close ? (close - bars[i - 5].close) / bars[i - 5].close : 0;
    const volZ = volStds[i] > 0 ? (vols[i] - volMeans[i]) / volStds[i] : 0;

    rows.push([
      (rsi - 50) / 50,       // rsi_norm ∈ [-1, 1]
      macdHistNorm,
      (adx - 25) / 25,       // adx centered at 25 (trend threshold)
      sma20Dev,
      sma50Dev,
      ret5,
      Math.max(-5, Math.min(5, volZ)) / 5, // clip + scale
    ]);
  }
  return rows;
}

function makeLabels(bars) {
  // Binary label: 1 if next bar closes higher, 0 otherwise.
  const y = Array(bars.length).fill(null);
  for (let i = 0; i < bars.length - 1; i++) {
    y[i] = bars[i + 1].close > bars[i].close ? 1 : 0;
  }
  return y;
}

function sigmoid(z) {
  if (z >= 0) { const e = Math.exp(-z); return 1 / (1 + e); }
  const e = Math.exp(z); return e / (1 + e);
}

/**
 * Train a logistic regression on the supplied bars. Returns weights, the
 * training accuracy, and a prediction function bound to those weights.
 *
 * @param {Array<{close:number, high:number, low:number, volume:number}>} bars
 * @param {object} [opts]
 * @param {number} [opts.epochs=200]
 * @param {number} [opts.lr=0.05]
 * @param {number} [opts.l2=0.01]
 */
export function trainModel(bars, { epochs = 200, lr = 0.05, l2 = 0.01 } = {}) {
  if (!Array.isArray(bars) || bars.length < 100) {
    throw new Error('Need ≥100 bars to train');
  }
  const feats = featurize(bars);
  const labels = makeLabels(bars);
  const X = [];
  const y = [];
  for (let i = 0; i < feats.length; i++) {
    if (feats[i] && labels[i] != null) { X.push(feats[i]); y.push(labels[i]); }
  }
  if (X.length < 50) throw new Error('Not enough feature rows after warmup');

  const d = X[0].length;
  const w = new Array(d).fill(0);
  let b = 0;

  for (let ep = 0; ep < epochs; ep++) {
    let gW = new Array(d).fill(0);
    let gB = 0;
    for (let i = 0; i < X.length; i++) {
      let z = b;
      for (let k = 0; k < d; k++) z += w[k] * X[i][k];
      const p = sigmoid(z);
      const err = p - y[i];
      for (let k = 0; k < d; k++) gW[k] += err * X[i][k];
      gB += err;
    }
    for (let k = 0; k < d; k++) {
      // L2 shrinkage on the gradient. Keeps weights from exploding when a
      // feature dominates the early epochs.
      w[k] -= lr * (gW[k] / X.length + l2 * w[k]);
    }
    b -= lr * (gB / X.length);
  }

  // Training accuracy — a sanity check, not a real out-of-sample score.
  let correct = 0;
  for (let i = 0; i < X.length; i++) {
    let z = b;
    for (let k = 0; k < d; k++) z += w[k] * X[i][k];
    const p = sigmoid(z);
    if ((p >= 0.5 ? 1 : 0) === y[i]) correct += 1;
  }
  const trainAcc = correct / X.length;

  return {
    weights: w, bias: b,
    trainSamples: X.length,
    trainAccuracy: trainAcc,
    featureNames: FEATURE_NAMES,
  };
}

/**
 * Predict up-probability for the final bar of `bars` using a trained model.
 */
export function predictLast(model, bars) {
  const feats = featurize(bars);
  const row = feats[feats.length - 1];
  if (!row) return null;
  let z = model.bias;
  for (let k = 0; k < row.length; k++) z += model.weights[k] * row[k];
  return sigmoid(z);
}

/**
 * Convenience: train on `trainBars`, then score `scoreBars` (which may be
 * the tail of the same series for proper out-of-sample evaluation).
 */
export function trainAndScore(trainBars, scoreBars) {
  const model = trainModel(trainBars);
  // Score accuracy on the held-out slice.
  const feats = featurize(scoreBars);
  const labels = makeLabels(scoreBars);
  let correct = 0, n = 0;
  for (let i = 0; i < feats.length; i++) {
    if (!feats[i] || labels[i] == null) continue;
    let z = model.bias;
    for (let k = 0; k < feats[i].length; k++) z += model.weights[k] * feats[i][k];
    const p = sigmoid(z);
    if ((p >= 0.5 ? 1 : 0) === labels[i]) correct += 1;
    n += 1;
  }
  return { model, oosSamples: n, oosAccuracy: n ? correct / n : 0 };
}
