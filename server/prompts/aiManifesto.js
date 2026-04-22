/**
 * AI Investment Manifesto — ticker-scoring prompt.
 *
 * Given a symbol and the seeded themes, asks the model to score the ticker
 * 0–10 against each of the 5 themes with a one-line rationale. Structured
 * output so the UI can render a grid instead of free prose.
 *
 * The tagline + thesis text of each theme is injected so the model uses the
 * *seeded* thesis definitions, not its own priors.
 */
import { sanitizeUserText } from '../services/promptSafety.js';

const s = (v) => sanitizeUserText(v, { maxLen: 800 });

export function buildManifestoPrompt({ symbol, themes }) {
  const clean = sanitizeUserText(symbol, { maxLen: 10 }).toUpperCase();
  const block = themes
    .map((t, i) =>
      `[${i + 1}] ${t.name} (slug=${t.slug})\n` +
      `    Tagline: ${s(t.tagline || '')}\n` +
      `    Thesis:  ${s((t.thesisMd || '').slice(0, 600))}`,
    )
    .join('\n\n');

  return (
`Score the ticker ${clean} against each of these AI investment themes.
For EACH theme return a fit score from 0–10 (0 = no fit, 10 = direct pure-play) and a single-sentence rationale.

Themes:
${block}

Respond as a JSON object with this exact shape — no prose before or after:
{
  "symbol": "${clean}",
  "overall": <0-10 numeric>,
  "summary": "<one paragraph summarising the ticker's overall manifesto fit>",
  "scores": [
    { "slug": "<theme slug>", "score": <0-10>, "rationale": "<one sentence>" }
    // ... one entry per theme, in the order given above
  ]
}`
  );
}
