/**
 * Prompt-injection mitigations for user-generated content that flows into LLM prompts.
 *
 * We cannot *prevent* prompt injection — the upstream model ultimately decides what to
 * do with the text. What we can do is (a) strip the most obvious manipulation phrases,
 * (b) cap length, and (c) wrap user content in a sentinel so the system prompt can
 * instruct the model to ignore instructions within it.
 */

const INJECTION_PATTERNS = [
  /ignore (the )?(previous|prior|above) (instructions?|prompts?)/gi,
  /disregard (the )?(previous|prior|above) (instructions?|prompts?)/gi,
  /forget (everything|all previous)/gi,
  /you are now/gi,
  /act as (a|an) /gi,
  /system prompt/gi,
  /<\|im_start\|>/g,
  /<\|im_end\|>/g,
  /\[INST\]/g,
  /\[\/INST\]/g,
];

const USER_CONTENT_OPEN = '<<<USER_CONTENT>>>';
const USER_CONTENT_CLOSE = '<<<END_USER_CONTENT>>>';

/** Strip obvious injection phrases and clamp length. Safe to apply to any free-text field. */
export function sanitizeUserText(text, { maxLen = 1000 } = {}) {
  if (text == null) return '';
  let s = String(text);
  for (const p of INJECTION_PATTERNS) s = s.replace(p, '[redacted]');
  // Remove any sentinel collisions so an attacker can't close the wrapper early.
  s = s.replaceAll(USER_CONTENT_OPEN, '').replaceAll(USER_CONTENT_CLOSE, '');
  // Cap the final string length including the ellipsis marker so `maxLen`
  // is a true upper bound on the returned string's .length.
  if (s.length > maxLen) s = s.slice(0, Math.max(0, maxLen - 1)) + '…';
  return s;
}

/** Wrap a sanitized string so the system prompt can refer to this region as untrusted. */
export function wrapUserContent(text, opts) {
  return `${USER_CONTENT_OPEN}\n${sanitizeUserText(text, opts)}\n${USER_CONTENT_CLOSE}`;
}
