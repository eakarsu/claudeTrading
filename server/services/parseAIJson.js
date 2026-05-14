/**
 * parseAIJson — robust 3-strategy parser for LLM JSON responses.
 *
 * LLMs frequently wrap JSON in markdown fences, prepend prose, or trail an
 * explanation. This helper attempts three strategies in order before giving up:
 *
 *   1. Strip ```json … ``` fences and JSON.parse the remainder.
 *   2. Locate the first balanced { … } or [ … ] block via regex and parse.
 *   3. Best-effort cleanup: remove trailing commas + smart quotes, retry once.
 *
 * Returns { ok: true, data } on success or { ok: false, raw, error } on failure.
 * Callers decide how to surface the failure (typically HTTP 502 with `raw` for
 * client-side debugging in dev, scrubbed in prod).
 */

export function parseAIJson(raw, { fallback = null } = {}) {
  if (raw == null) return { ok: false, raw: '', error: 'empty input', data: fallback };
  const text = String(raw).trim();
  if (!text) return { ok: false, raw: '', error: 'empty input', data: fallback };

  // Strategy 1: strip fenced code block.
  const fenced = text
    .replace(/^```(?:json|JSON)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();
  try {
    return { ok: true, data: JSON.parse(fenced), strategy: 'fence' };
  } catch (_) {
    /* fall through */
  }

  // Strategy 2: extract first balanced object or array.
  const objMatch = fenced.match(/\{[\s\S]*\}/);
  const arrMatch = fenced.match(/\[[\s\S]*\]/);
  let candidate = null;
  if (objMatch && arrMatch) {
    candidate = objMatch.index < arrMatch.index ? objMatch[0] : arrMatch[0];
  } else {
    candidate = objMatch?.[0] ?? arrMatch?.[0] ?? null;
  }
  if (candidate) {
    try {
      return { ok: true, data: JSON.parse(candidate), strategy: 'extract' };
    } catch (_) {
      /* fall through */
    }
  }

  // Strategy 3: aggressive cleanup of common LLM JSON sins.
  const cleaned = (candidate || fenced)
    .replace(/[\u201C\u201D]/g, '"')   // smart double quotes → straight
    .replace(/[\u2018\u2019]/g, "'")   // smart single quotes → straight
    .replace(/,(\s*[}\]])/g, '$1')      // trailing commas before } or ]
    .replace(/[\u0000-\u001F]+/g, ' '); // control chars
  try {
    return { ok: true, data: JSON.parse(cleaned), strategy: 'cleanup' };
  } catch (err) {
    return {
      ok: false,
      raw: text.slice(0, 1000),
      error: err.message,
      data: fallback,
    };
  }
}

export default parseAIJson;
