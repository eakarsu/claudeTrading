import { DocsPage } from '../models/index.js';
import { logger } from '../logger.js';
import { refreshSource } from './docsCrawler.js';
import { importFromFile } from './docsImporter.js';

/**
 * Periodic docs-mirror refresh.
 *
 * Bootstrap strategy: if the corpus is empty, import from the local
 * pre-crawled file (`requirements.txt` at the repo root). The network crawler
 * remains the path for scheduled/manual refreshes against upstream.
 *
 * Opt-out: set DOCS_REFRESH_INTERVAL_MS=0 to disable entirely.
 */

const DEFAULT_INTERVAL_MS = 24 * 60 * 60 * 1000; // daily
const INTERVAL_MS = parseInt(
  process.env.DOCS_REFRESH_INTERVAL_MS ?? String(DEFAULT_INTERVAL_MS),
  10,
);
const STALE_AFTER_MS = INTERVAL_MS || DEFAULT_INTERVAL_MS;
const SOURCE = 'freqtrade';

let timer = null;

async function maybeBootstrap() {
  const row = await DocsPage.findOne({
    where: { source: SOURCE },
    order: [['fetchedAt', 'DESC']],
  });
  if (!row) {
    logger.info({ source: SOURCE }, 'Docs corpus empty — importing from local file');
    return importFromFile(SOURCE).catch((err) =>
      logger.warn({ err }, 'Initial docs import failed'),
    );
  }
  const age = Date.now() - new Date(row.fetchedAt || 0).getTime();
  if (age > STALE_AFTER_MS) {
    logger.info({ source: SOURCE, ageMs: age }, 'Docs corpus stale — refreshing from upstream');
    return refreshSource(SOURCE).catch((err) =>
      logger.warn({ err }, 'Docs refresh failed'),
    );
  }
  return null;
}

export function startDocsScheduler() {
  if (timer) return;
  if (!Number.isFinite(INTERVAL_MS) || INTERVAL_MS <= 0) {
    logger.info('Docs scheduler disabled (DOCS_REFRESH_INTERVAL_MS=0)');
    return;
  }
  // Bootstrap without blocking the caller.
  maybeBootstrap().catch(() => {});
  timer = setInterval(() => {
    refreshSource(SOURCE).catch((err) =>
      logger.warn({ err }, 'Scheduled docs refresh failed'),
    );
  }, INTERVAL_MS);
  timer.unref?.();
  logger.info({ intervalMs: INTERVAL_MS }, 'Docs scheduler started');
}

export function stopDocsScheduler() {
  if (timer) { clearInterval(timer); timer = null; }
}
