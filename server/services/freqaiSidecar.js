/**
 * FreqAI Python sidecar — protocol stub.
 *
 * The native freqaiLite.js trainer is a tiny JS-only logreg/perceptron. For
 * heavy models (XGBoost, LightGBM, PyTorch) freqtrade relies on Python. This
 * module defines the HTTP protocol we'd use to speak to an external Python
 * service, and stubs out the calls. If FREQAI_PY_URL is set we proxy to it;
 * otherwise every endpoint returns `{ configured: false, ... }` so the UI
 * can degrade gracefully.
 *
 * Protocol (all JSON):
 *
 *   GET  /health                              → { ok, version, backends: [...] }
 *   POST /train   { bars, features, target }  → { modelId, metrics }
 *   POST /predict { modelId, bars }           → { predictions: [...] }
 *   GET  /models                              → { items: [{ modelId, backend, trainedAt, metrics }] }
 *   DELETE /models/:id                        → { ok }
 *
 * Transport: plain fetch. Authentication: optional bearer token via
 * FREQAI_PY_TOKEN. No streaming, no websockets — keep the surface narrow.
 */

const URL = () => process.env.FREQAI_PY_URL || null;
const TOKEN = () => process.env.FREQAI_PY_TOKEN || null;
const TIMEOUT_MS = 30_000;

export function isConfigured() {
  return !!URL();
}

function notConfigured() {
  return {
    configured: false,
    reason: 'FREQAI_PY_URL not set. Run a Python sidecar and export FREQAI_PY_URL to enable.',
  };
}

async function pycall(path, { method = 'GET', body = null, timeoutMs = TIMEOUT_MS } = {}) {
  const base = URL();
  if (!base) return notConfigured();

  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const res = await fetch(`${base.replace(/\/$/, '')}${path}`, {
      method,
      signal: ctl.signal,
      headers: {
        'Content-Type': 'application/json',
        ...(TOKEN() ? { Authorization: `Bearer ${TOKEN()}` } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    let data; try { data = text ? JSON.parse(text) : {}; } catch { data = { raw: text }; }
    if (!res.ok) {
      return { configured: true, ok: false, status: res.status, error: data?.error || text || res.statusText };
    }
    return { configured: true, ok: true, ...data };
  } catch (err) {
    return { configured: true, ok: false, error: err.name === 'AbortError' ? 'timeout' : err.message };
  } finally {
    clearTimeout(timer);
  }
}

export function health()            { return pycall('/health'); }
export function listModels()        { return pycall('/models'); }
export function deleteModel(id)     { return pycall(`/models/${encodeURIComponent(id)}`, { method: 'DELETE' }); }
export function train(payload)      { return pycall('/train',   { method: 'POST', body: payload, timeoutMs: 120_000 }); }
export function predict(payload)    { return pycall('/predict', { method: 'POST', body: payload }); }
