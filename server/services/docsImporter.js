import fs from 'fs/promises';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import { DocsPage } from '../models/index.js';
import { logger } from '../logger.js';
import { getSource } from './docsRegistry.js';

/**
 * Offline docs importer.
 *
 * The freqtrade docs were pre-crawled into `requirements.txt` at the repo root.
 * Each page begins with a top-level `# Heading` — this module splits on that
 * boundary and upserts each chunk into `docs_pages`.
 *
 * We match heading text to registry slugs via an explicit alias table because
 * the upstream titles and our registry labels diverge (e.g. "Stop Loss" vs
 * "Stoploss", "Webhook Usage" vs "Web Hook"). Aliases are ordered longest-first
 * so "Advanced Hyperopt" matches before "Hyperopt".
 */

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_PATH = path.resolve(__dirname, '..', '..', 'requirements.txt');
const IMPORT_PATH = process.env.DOCS_IMPORT_FILE || DEFAULT_PATH;

// Heading prefix (normalized) → registry slug. Order matters for prefix
// matching: longer, more specific entries first so "advanced hyperopt" wins
// over "hyperopt".
const ALIASES = [
  ['advanced backtesting analysis',              'advanced-backtesting'],
  ['backtesting',                                'backtesting'],
  ['advanced post-installation',                 'advanced-setup'],
  ['advanced hyperopt',                          'advanced-hyperopt'],
  ['advanced strategy',                          'strategy-advanced'],
  ['analyzing bot data with jupyter',            'data-analysis'],
  ['contributors guide',                         'developer'],
  ['data downloading',                           'data-download'],
  ['deprecated features',                        'deprecated'],
  ['exchange-specific notes',                    'exchanges'],
  ['feature engineering',                        'freqai-feature-engineering'],
  ['freqai configuration',                       'freqai-configuration'],
  ['freqai developer',                           'freqai-developers'],
  ['freqai introduction',                        'freqai'],
  ['freqai parameter',                           'freqai-parameter-table'],
  ['freqtrade basics',                           'bot-basics'],
  ['freqtrade configuration',                    'configuration'],
  ['freqtrade documentation',                    ''],                // home
  ['freqtrade faq',                              'faq'],
  ['freqtrade strategies 101',                   'strategy-101'],
  ['frequi',                                     'freq-ui'],
  ['hyperopt',                                   'hyperopt'],
  ['installation',                               'installation'],
  ['lookahead analysis',                         'lookahead-analysis'],
  ['orderflow data',                             'advanced-orderflow'],
  ['plotting',                                   'plotting'],
  ['plugins',                                    'plugins'],
  ['producer/consumer',                          'producer-consumer'],
  ['quickstart with docker',                     'docker_quickstart'],
  ['recursive analysis',                         'recursive-analysis'],
  ['reinforcement learning',                     'freqai-reinforcement-learning'],
  ['rest api',                                   'rest-api'],
  ['running freqai',                             'freqai-running'],
  ['sql cheat',                                  'sql_cheatsheet'],
  ['start the bot',                              'bot-usage'],
  ['stop loss',                                  'stoploss'],
  ['strategy analysis example',                  'strategy_analysis_example'],
  ['strategy callbacks',                         'strategy-callbacks'],
  ['strategy customization',                     'strategy-customization'],
  ['strategy migration',                         'strategy_migration'],
  ['telegram usage',                             'telegram-usage'],
  ['trade object',                               'trade-object'],
  ['trading with leverage',                      'leverage'],
  ['updating freqtrade',                         'updating'],
  ['utility sub-commands',                       'utils'],
  ['webhook usage',                              'webhook-config'],
];

function normalizeHeading(text) {
  return text
    .toLowerCase()
    .replace(/[:\-–—]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// Normalize alias prefixes through the same transform as headings so that
// hyphens in e.g. "exchange-specific notes" line up with the space-collapsed
// headings coming from the file. Sort longest-first so specific prefixes win.
const NORMALIZED_ALIASES = ALIASES
  .map(([prefix, slug]) => [normalizeHeading(prefix), slug])
  .sort((a, b) => b[0].length - a[0].length);

function matchSlug(heading) {
  const norm = normalizeHeading(heading);
  for (const [prefix, slug] of NORMALIZED_ALIASES) {
    if (norm.startsWith(prefix)) return slug;
  }
  return null;
}

function sha1(input) {
  return crypto.createHash('sha1').update(input).digest('hex');
}

/**
 * Split the corpus into { heading, body } chunks on top-level `# ` lines.
 * A leading preamble (anything before the first `# `) is discarded.
 */
function splitIntoPages(corpus) {
  const pages = [];
  const lines = corpus.split('\n');
  let current = null;
  for (const line of lines) {
    const m = line.match(/^# (.+)$/);
    if (m) {
      if (current) pages.push(current);
      current = { heading: m[1].trim(), bodyLines: [] };
    } else if (current) {
      current.bodyLines.push(line);
    }
  }
  if (current) pages.push(current);
  return pages.map((p) => ({
    heading: p.heading,
    // Keep the H1 in the markdown so the rendered page has a title.
    markdown: `# ${p.heading}\n${p.bodyLines.join('\n')}`.trim(),
  }));
}

export async function importFromFile(sourceName = 'freqtrade', { filePath = IMPORT_PATH } = {}) {
  const source = getSource(sourceName);
  if (!source) throw new Error(`Unknown docs source: ${sourceName}`);

  let raw;
  try {
    raw = await fs.readFile(filePath, 'utf8');
  } catch (err) {
    throw new Error(`Failed to read import file ${filePath}: ${err.message}`);
  }

  const registryBySlug = new Map(source.pages.map((p) => [p.slug, p]));
  const pages = splitIntoPages(raw);

  const results = { created: 0, updated: 0, unchanged: 0, unmatched: 0, errors: [] };
  const seenSlugs = new Set();

  for (const page of pages) {
    const slug = matchSlug(page.heading);
    if (slug === null) {
      results.unmatched += 1;
      results.errors.push({ heading: page.heading, reason: 'no slug alias' });
      logger.warn({ heading: page.heading }, 'Docs import: no alias match');
      continue;
    }
    const reg = registryBySlug.get(slug);
    if (!reg) {
      results.unmatched += 1;
      results.errors.push({ heading: page.heading, reason: `slug "${slug}" not in registry` });
      continue;
    }
    if (seenSlugs.has(slug)) {
      results.errors.push({ heading: page.heading, reason: `duplicate slug "${slug}"` });
      continue;
    }
    seenSlugs.add(slug);

    const hash = sha1(page.markdown);
    const existing = await DocsPage.findOne({ where: { source: sourceName, slug } });

    const payload = {
      source: sourceName,
      slug,
      title: reg.title,
      section: reg.section,
      order: reg.order,
      url: reg.url,
      markdown: page.markdown,
      htmlHash: hash,
      fetchedAt: new Date(),
    };

    if (!existing) {
      await DocsPage.create(payload);
      results.created += 1;
    } else if (existing.htmlHash === hash) {
      await existing.update({ fetchedAt: new Date() });
      results.unchanged += 1;
    } else {
      await existing.update(payload);
      results.updated += 1;
    }
  }

  logger.info({ source: sourceName, ...results }, 'Docs import complete');
  return results;
}
