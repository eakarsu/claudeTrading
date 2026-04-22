/**
 * Static registry of external doc corpora the app mirrors.
 *
 * Keeping the list in code (rather than scraping a sitemap at crawl time)
 * makes the TOC ordering deterministic and lets us assign sections for UI
 * grouping. New pages surface by editing this file and triggering a refresh.
 */

const FREQTRADE_BASE = 'https://www.freqtrade.io/en/stable';

// Ordered list — the UI renders the sidebar in this order. `section` groups
// pages in the TOC accordion. Slugs are the MkDocs path segments (without
// trailing slash); the crawler appends `/` and fetches `<base>/<slug>/`.
const FREQTRADE_PAGES = [
  { slug: '',                              title: 'Home',                        section: 'Introduction' },
  { slug: 'docker_quickstart',             title: 'Quickstart with Docker',      section: 'Introduction' },
  { slug: 'installation',                  title: 'Installation',                section: 'Introduction' },
  { slug: 'bot-basics',                    title: 'Freqtrade Basics',            section: 'Introduction' },
  { slug: 'configuration',                 title: 'Configuration',               section: 'Configuration' },
  { slug: 'strategy-101',                  title: 'Strategy Quickstart',         section: 'Strategy' },
  { slug: 'strategy-customization',        title: 'Strategy Customization',      section: 'Strategy' },
  { slug: 'strategy-callbacks',            title: 'Strategy Callbacks',          section: 'Strategy' },
  { slug: 'stoploss',                      title: 'Stoploss',                    section: 'Strategy' },
  { slug: 'plugins',                       title: 'Plugins',                     section: 'Strategy' },
  { slug: 'bot-usage',                     title: 'Start the bot',               section: 'Operations' },
  { slug: 'telegram-usage',                title: 'Telegram',                    section: 'Operations' },
  { slug: 'freq-ui',                       title: 'freqUI',                      section: 'Operations' },
  { slug: 'rest-api',                      title: 'REST API',                    section: 'Operations' },
  { slug: 'webhook-config',                title: 'Web Hook',                    section: 'Operations' },
  { slug: 'data-download',                 title: 'Data Downloading',            section: 'Backtesting' },
  { slug: 'backtesting',                   title: 'Backtesting',                 section: 'Backtesting' },
  { slug: 'hyperopt',                      title: 'Hyperopt',                    section: 'Backtesting' },
  { slug: 'freqai',                        title: 'FreqAI Introduction',         section: 'FreqAI' },
  { slug: 'freqai-configuration',          title: 'FreqAI Configuration',        section: 'FreqAI' },
  { slug: 'freqai-parameter-table',        title: 'FreqAI Parameter table',      section: 'FreqAI' },
  { slug: 'freqai-feature-engineering',    title: 'FreqAI Feature engineering',  section: 'FreqAI' },
  { slug: 'freqai-running',                title: 'FreqAI Running',              section: 'FreqAI' },
  { slug: 'freqai-reinforcement-learning', title: 'FreqAI Reinforcement Learning', section: 'FreqAI' },
  { slug: 'freqai-developers',             title: 'FreqAI Developer guide',      section: 'FreqAI' },
  { slug: 'leverage',                      title: 'Short / Leverage',            section: 'Advanced' },
  { slug: 'utils',                         title: 'Utility Sub-commands',        section: 'Advanced' },
  { slug: 'plotting',                      title: 'Plotting',                    section: 'Advanced' },
  { slug: 'exchanges',                     title: 'Exchange-specific Notes',     section: 'Advanced' },
  { slug: 'data-analysis',                 title: 'Jupyter Notebooks',           section: 'Analysis' },
  { slug: 'strategy_analysis_example',     title: 'Strategy analysis',           section: 'Analysis' },
  { slug: 'advanced-backtesting',          title: 'Backtest analysis',           section: 'Analysis' },
  { slug: 'advanced-setup',                title: 'Advanced Post-installation',  section: 'Advanced' },
  { slug: 'trade-object',                  title: 'Trade Object',                section: 'Advanced' },
  { slug: 'lookahead-analysis',            title: 'Lookahead analysis',          section: 'Analysis' },
  { slug: 'recursive-analysis',            title: 'Recursive analysis',          section: 'Analysis' },
  { slug: 'strategy-advanced',             title: 'Advanced Strategy',           section: 'Strategy' },
  { slug: 'advanced-hyperopt',             title: 'Advanced Hyperopt',           section: 'Backtesting' },
  { slug: 'advanced-orderflow',            title: 'Orderflow',                   section: 'Advanced' },
  { slug: 'producer-consumer',             title: 'Producer/Consumer mode',      section: 'Advanced' },
  { slug: 'sql_cheatsheet',                title: 'SQL Cheat-sheet',             section: 'Reference' },
  { slug: 'faq',                           title: 'FAQ',                         section: 'Reference' },
  { slug: 'strategy_migration',            title: 'Strategy migration',          section: 'Reference' },
  { slug: 'updating',                      title: 'Updating Freqtrade',          section: 'Reference' },
  { slug: 'deprecated',                    title: 'Deprecated Features',         section: 'Reference' },
  { slug: 'developer',                     title: 'Contributors Guide',          section: 'Reference' },
];

export const sources = {
  freqtrade: {
    label: 'Freqtrade',
    homepage: 'https://www.freqtrade.io/',
    license: 'GPL-3.0',
    attribution: 'Source: freqtrade.io — licensed under GPL-3.0',
    base: FREQTRADE_BASE,
    pages: FREQTRADE_PAGES.map((p, i) => ({
      ...p,
      order: i,
      url: `${FREQTRADE_BASE}/${p.slug}${p.slug ? '/' : ''}`,
    })),
  },
};

export function getSource(name) {
  return sources[name] || null;
}

export function listSources() {
  return Object.entries(sources).map(([name, s]) => ({
    name,
    label: s.label,
    license: s.license,
    attribution: s.attribution,
    homepage: s.homepage,
    pageCount: s.pages.length,
  }));
}
