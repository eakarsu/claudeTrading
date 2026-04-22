import { Op } from 'sequelize';
import { DocsPage } from '../models/index.js';
import { getSource } from './docsRegistry.js';

/**
 * Pull the most relevant docs pages for a free-text query so we can inject
 * them as grounding context for AI endpoints.
 *
 * Scoring is intentionally simple — good enough for a 46-page corpus:
 *   1. Tokenize the query (drop stopwords, keep words ≥ 3 chars).
 *   2. For each token, count occurrences in title (×5 weight) and markdown (×1).
 *   3. Sum weighted hits per page; keep top-K non-zero.
 *   4. Build a short excerpt around the first match in markdown.
 *
 * No FTS index, no embeddings — we'll upgrade to tsvector or a vector store
 * if/when the corpus grows or retrieval quality becomes the bottleneck.
 */

const STOPWORDS = new Set([
  'the', 'and', 'for', 'with', 'from', 'this', 'that', 'what', 'when', 'how',
  'why', 'where', 'which', 'who', 'does', 'can', 'could', 'should', 'would',
  'about', 'into', 'your', 'our', 'their', 'they', 'them', 'have', 'has',
  'will', 'just', 'but', 'not', 'are', 'was', 'were', 'been', 'being', 'any',
  'all', 'some', 'more', 'most', 'than', 'then', 'also', 'only', 'very',
]);

function tokenize(query) {
  return String(query || '')
    .toLowerCase()
    .match(/[a-z][a-z0-9_-]{2,}/g)
    ?.filter((t) => !STOPWORDS.has(t)) ?? [];
}

function countOccurrences(haystack, needle) {
  if (!haystack || !needle) return 0;
  let count = 0;
  let idx = 0;
  while ((idx = haystack.indexOf(needle, idx)) !== -1) {
    count += 1;
    idx += needle.length;
  }
  return count;
}

function buildExcerpt(markdown, tokens, maxLen = 500) {
  const md = markdown || '';
  const lower = md.toLowerCase();
  let firstIdx = -1;
  for (const t of tokens) {
    const i = lower.indexOf(t);
    if (i !== -1 && (firstIdx === -1 || i < firstIdx)) firstIdx = i;
  }
  if (firstIdx === -1) {
    return md.slice(0, maxLen) + (md.length > maxLen ? '…' : '');
  }
  const start = Math.max(0, firstIdx - 120);
  const end = Math.min(md.length, firstIdx + maxLen - 120);
  const prefix = start > 0 ? '…' : '';
  const suffix = end < md.length ? '…' : '';
  return `${prefix}${md.slice(start, end).replace(/```[\s\S]*?```/g, '[code block]')}${suffix}`;
}

/**
 * Retrieve top-K relevant pages for a query.
 *
 * @param {string} query Free-text user question.
 * @param {object} opts
 * @param {string} [opts.source='freqtrade'] Registry source slug.
 * @param {number} [opts.limit=3]  Max pages returned.
 * @param {number} [opts.maxExcerptLen=500] Excerpt character budget per page.
 * @returns {Promise<Array<{slug,title,section,url,score,excerpt}>>}
 */
export async function retrieveRelevantDocs(query, opts = {}) {
  const { source = 'freqtrade', limit = 3, maxExcerptLen = 500 } = opts;
  if (!getSource(source)) return [];

  const tokens = tokenize(query);
  if (tokens.length === 0) return [];

  // Narrow candidate pool with ILIKE on any token — avoids scanning the full
  // table when the query is very specific.
  const rows = await DocsPage.findAll({
    where: {
      source,
      [Op.or]: tokens.flatMap((t) => [
        { title:    { [Op.iLike]: `%${t}%` } },
        { markdown: { [Op.iLike]: `%${t}%` } },
      ]),
    },
    attributes: ['slug', 'title', 'section', 'url', 'markdown'],
    limit: 40,
  });

  const scored = rows.map((r) => {
    const titleLower = (r.title || '').toLowerCase();
    const mdLower = (r.markdown || '').toLowerCase();
    let score = 0;
    for (const t of tokens) {
      score += countOccurrences(titleLower, t) * 5;
      score += countOccurrences(mdLower, t);
    }
    return {
      slug: r.slug,
      title: r.title,
      section: r.section,
      url: r.url,
      score,
      excerpt: buildExcerpt(r.markdown, tokens, maxExcerptLen),
    };
  }).filter((r) => r.score > 0);

  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, limit);
}

/**
 * Format retrieved pages as a plain-text context block suitable for pasting
 * into a Claude prompt's context field. Each page is tagged with its slug so
 * the model can cite it back.
 */
export function formatDocsContext(docs, { sourceLabel = 'freqtrade docs' } = {}) {
  if (!docs?.length) return '';
  const lines = [`Relevant ${sourceLabel} (use these as the authoritative reference; cite the [slug] when you draw on them):`];
  for (const d of docs) {
    lines.push('');
    lines.push(`[${d.slug}] ${d.title}${d.section ? ` — ${d.section}` : ''}`);
    lines.push(d.excerpt);
  }
  return lines.join('\n');
}
