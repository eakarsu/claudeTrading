import { Router } from 'express';
import { asyncHandler } from '../middleware/async.js';
import { validate } from '../middleware/validate.js';
import { askAI } from '../services/openrouter.js';
import { wrapUserContent } from '../services/promptSafety.js';
import { retrieveRelevantDocs, formatDocsContext } from '../services/docsGrounding.js';
import { aiChatSchema, aiOptionsSchema } from '../schemas.js';
import { CopyTrade, PortfolioItem, RiskAssessment, MarketNews, OptionsChain, Theme, ThemeConstituent } from '../models/index.js';
import { buildManifestoPrompt } from '../prompts/aiManifesto.js';
import * as alpaca from '../services/alpaca.js';
import { getLatestTradePrices } from '../services/priceCache.js';
import { logger } from '../logger.js';

const router = Router();

// Symbols we snapshot for the "market summary" prompt. SPY/QQQ/DIA/IWM cover
// broad indices; XL* are S&P sector SPDRs so the model can comment on sector
// rotation without making numbers up.
const MARKET_SNAPSHOT_SYMBOLS = [
  'SPY', 'QQQ', 'DIA', 'IWM',
  'XLK', 'XLF', 'XLE', 'XLV', 'XLY', 'XLI', 'XLP', 'XLU', 'XLRE', 'XLB', 'XLC',
];

/**
 * Build a compact text snapshot of "what's happening right now" to attach as
 * context for AI endpoints. Pulls Alpaca clock + index/sector quotes + recent
 * news in parallel; any sub-fetch that fails is omitted rather than failing
 * the whole endpoint. The output is plain text so the model quotes it back.
 */
async function buildMarketSnapshot() {
  const [clock, quotes, news] = await Promise.all([
    alpaca.getClock().catch((err) => { logger.warn({ err }, 'market-summary: clock failed'); return null; }),
    getLatestTradePrices(MARKET_SNAPSHOT_SYMBOLS, { maxAgeMs: 60_000 })
      .catch((err) => { logger.warn({ err }, 'market-summary: quotes failed'); return {}; }),
    MarketNews.findAll({ order: [['createdAt', 'DESC']], limit: 15 })
      .catch((err) => { logger.warn({ err }, 'market-summary: news failed'); return []; }),
  ]);

  const lines = [`As of ${new Date().toISOString()}:`];
  if (clock) {
    lines.push(`Market is ${clock.is_open ? 'OPEN' : 'CLOSED'}. Next ${clock.is_open ? `close at ${clock.next_close}` : `open at ${clock.next_open}`}.`);
  }
  const quoteLine = (group, syms) => {
    const parts = syms.map((s) => {
      const p = quotes[s]?.p;
      return Number.isFinite(p) ? `${s}=$${p.toFixed(2)}` : null;
    }).filter(Boolean);
    if (parts.length) lines.push(`${group}: ${parts.join(', ')}`);
  };
  quoteLine('Indices (last trade)', ['SPY', 'QQQ', 'DIA', 'IWM']);
  quoteLine('Sector ETFs', ['XLK', 'XLF', 'XLE', 'XLV', 'XLY', 'XLI', 'XLP', 'XLU', 'XLRE', 'XLB', 'XLC']);
  if (news.length) {
    lines.push('Recent headlines:');
    for (const n of news) {
      const tag = n.symbol ? `[${n.symbol}]` : '[MKT]';
      const sent = n.sentiment ? ` (${n.sentiment})` : '';
      lines.push(`- ${tag}${sent} ${n.title}`);
    }
  }
  return lines.join('\n');
}

router.post('/chat', validate({ body: aiChatSchema }), asyncHandler(async (req, res) => {
  const { prompt, feature, groundWithDocs } = req.body;

  // Features that benefit from freqtrade docs grounding — either the caller
  // opts in explicitly via `groundWithDocs`, or the feature name hints at
  // strategy/docs work.
  const shouldGround = groundWithDocs === true
    || feature === 'docs'
    || feature === 'strategy-lab'
    || feature === 'strategy';

  let docsContext = '';
  let citations = [];
  if (shouldGround) {
    const docs = await retrieveRelevantDocs(prompt, { limit: 3 }).catch((err) => {
      logger.warn({ err }, 'chat: docs grounding retrieval failed');
      return [];
    });
    citations = docs.map(({ slug, title, section, url }) => ({ slug, title, section, url }));
    docsContext = formatDocsContext(docs);
  }

  const featureLine = feature
    ? `You are assisting with the "${feature}" feature of a trading platform.`
    : '';
  const context = [featureLine, docsContext].filter(Boolean).join('\n\n');

  const result = await askAI(wrapUserContent(prompt), context, { userId: req.userId });
  res.json({
    analysis: result.content,
    model: result.model,
    usage: result.usage,
    citations,        // UI can render these as "mentioned in docs" chips
    grounded: shouldGround,
  });
}));

router.post('/market-summary', asyncHandler(async (req, res) => {
  const snapshot = await buildMarketSnapshot();
  const result = await askAI(
    'Using ONLY the live market data provided below, write a concise market summary for a day trader and a swing trader. '
    + 'Reference specific index/sector prices from the snapshot — do not invent numbers. '
    + 'Call out which sectors look strongest/weakest based on the quotes, and weave in the most relevant headlines. '
    + 'If the market is closed, frame it as a pre/post-session recap. Keep it under 300 words.',
    snapshot,
    { userId: req.userId },
  );
  res.json({ analysis: result.content, model: result.model, usage: result.usage, snapshot });
}));

router.post('/portfolio-review', asyncHandler(async (req, res) => {
  // Pull the authoritative snapshot from Alpaca (live positions + account)
  // in addition to the per-user PortfolioItem table — the latter often holds
  // notional holdings the user is tracking, while Alpaca is what actually
  // executed. The model gets both so its advice references real numbers.
  const [portfolio, account, alpacaPositions] = await Promise.all([
    PortfolioItem.findAll({ where: { userId: req.userId } }).catch(() => []),
    alpaca.getAccount().catch(() => null),
    alpaca.getPositions().catch(() => []),
  ]);
  const holdings = portfolio
    .map((p) => `${p.symbol}: ${p.qty} shares, avg $${p.avgPrice}, current $${p.currentPrice}, P&L $${p.pnl}`)
    .join('\n');
  const live = alpacaPositions
    .map((p) => `${p.symbol}: ${p.qty}@${p.avg_entry_price} now $${p.current_price} (P&L $${p.unrealized_pl}, ${(Number(p.unrealized_plpc) * 100).toFixed(2)}%)`)
    .join('\n') || 'No open positions in Alpaca.';
  const acct = account ? `Equity $${account.equity}, cash $${account.cash}, buying power $${account.buying_power}` : 'Alpaca account unavailable.';
  const context = `Account: ${acct}\nAlpaca live positions:\n${live}\nTracked portfolio (may include notionals):\n${holdings || '(empty)'}`;
  const result = await askAI(
    'Review the portfolio snapshot below and give: 1) Overall portfolio health 2) Diversification analysis 3) Top 3 concrete actions to take 4) Risk assessment. '
    + 'Quote specific symbols and P&L numbers from the snapshot — do not invent positions.',
    context,
    { userId: req.userId },
  );
  res.json({ analysis: result.content, model: result.model, usage: result.usage });
}));

router.post('/trade-idea', asyncHandler(async (req, res) => {
  // Idea generation used to be a stateless "pick a stock" prompt — the model
  // refused because it has no live feed. Now we attach the same snapshot used
  // by market-summary plus the user's watchlist so Claude picks from real
  // quotes instead of hallucinating entries.
  const snapshot = await buildMarketSnapshot();
  const result = await askAI(
    'Based ONLY on the live market data below, propose ONE specific trade idea. '
    + 'Pick a symbol that appears in the snapshot (or a close proxy), then output: '
    + 'symbol, direction (long/short), entry price, target, stop, suggested position size as % of equity, timeframe (intraday/swing), and reasoning. '
    + 'Cite the specific quote(s) you used. If nothing looks tradeable, say so.',
    snapshot,
    { userId: req.userId },
  );
  res.json({ analysis: result.content, model: result.model, usage: result.usage, snapshot });
}));

router.post('/risk-report', asyncHandler(async (req, res) => {
  const risks = await RiskAssessment.findAll();
  const positions = risks
    .map((r) => `${r.symbol}: $${r.positionSize} position, ${r.riskLevel} risk, max loss $${r.maxLoss}, vol ${r.volatility}%`)
    .join('\n');
  const result = await askAI(
    `Analyze my overall risk exposure:\n${positions}\n\nProvide: 1) Total portfolio risk score 2) Most dangerous positions 3) Correlation risks 4) Hedging recommendations 5) Position sizing adjustments needed`,
    '',
    { userId: req.userId },
  );
  res.json({ analysis: result.content, model: result.model, usage: result.usage });
}));

router.post('/options-strategy', validate({ body: aiOptionsSchema }), asyncHandler(async (req, res) => {
  const symbol = req.body.symbol || 'TSLA';
  // Attach underlying quote + any options rows we have for this symbol. When
  // the chain is empty we still give the model the spot price so strikes make
  // sense.
  const [latest, chain] = await Promise.all([
    getLatestTradePrices([symbol], { maxAgeMs: 60_000 }).catch(() => ({})),
    OptionsChain.findAll({ where: { symbol }, limit: 40 }).catch(() => []),
  ]);
  const spot = latest[symbol]?.p;
  const chainLines = chain.map((o) =>
    `${o.type} ${o.strike} exp ${o.expiration} bid/ask ~$${o.premium} IV ${o.iv} delta ${o.delta} OI ${o.openInterest}`
  ).join('\n');
  const context = [
    `Symbol: ${symbol}`,
    Number.isFinite(spot) ? `Spot: $${spot.toFixed(2)}` : 'Spot: unknown (no recent trade)',
    chainLines ? `Options chain (up to 40 rows):\n${chainLines}` : 'Options chain not populated locally.',
  ].join('\n');
  const result = await askAI(
    `Suggest the best options strategy for ${symbol} right now given the data below. `
    + 'Propose specific strikes/expirations chosen from the chain if provided; otherwise propose reasonable ones relative to spot. '
    + 'Include max profit, max loss, break-even(s), and when the trade is appropriate. '
    + 'Do NOT invent a spot price if one is missing — say so and propose ranges.',
    context,
    { userId: req.userId },
  );
  res.json({ analysis: result.content, model: result.model, usage: result.usage });
}));

router.post('/politician-analysis', asyncHandler(async (req, res) => {
  const trades = await CopyTrade.findAll();
  const tradeList = trades
    .map((t) => `${t.politician}: ${t.action} ${t.symbol} ($${t.totalValue}) on ${t.tradeDate}`)
    .join('\n');
  const result = await askAI(
    `Analyze these politician stock trades for patterns and insights:\n${tradeList}\n\nProvide: 1) Most active politicians 2) Sector patterns 3) Suspicious timing 4) Best trades to copy 5) Trades to avoid`,
    '',
    { userId: req.userId },
  );
  res.json({ analysis: result.content, model: result.model, usage: result.usage });
}));

// ─── AI Manifesto: score a single ticker against seeded investment themes ───
// Returns structured per-theme scores so the UI can render a grid (not prose).
// We parse the JSON ourselves so a misbehaving model response surfaces as a
// 502 rather than leaking raw text downstream.
router.post('/theme-manifesto', asyncHandler(async (req, res) => {
  const { symbol } = req.body || {};
  if (!symbol || typeof symbol !== 'string') {
    return res.status(400).json({ error: 'symbol required' });
  }

  const themes = await Theme.findAll({ order: [['order', 'ASC'], ['id', 'ASC']] });
  if (!themes.length) {
    return res.status(503).json({ error: 'No themes seeded. Run seed.js first.' });
  }

  // Attach constituents per theme so the model knows if this symbol is
  // already a named constituent (high fit) vs an outside pick.
  const themeBlocks = [];
  const isConstituentOf = [];
  for (const t of themes) {
    const cs = await ThemeConstituent.findAll({ where: { themeId: t.id } });
    if (cs.some((c) => c.symbol.toUpperCase() === String(symbol).toUpperCase())) {
      isConstituentOf.push(t.slug);
    }
    themeBlocks.push({
      slug: t.slug, name: t.name, tagline: t.tagline, thesisMd: t.thesisMd,
    });
  }

  const prompt = buildManifestoPrompt({ symbol, themes: themeBlocks });
  const result = await askAI(
    wrapUserContent(prompt),
    'You are a structured scoring engine for an investment-themes feature. '
    + 'Return valid JSON only, no surrounding prose.',
    { userId: req.userId },
  );

  // Parse the JSON body. Model sometimes wraps in ```json fences — strip those.
  const raw = String(result.content || '').trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '');
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    logger.warn({ raw: raw.slice(0, 200) }, 'theme-manifesto: model returned non-JSON');
    return res.status(502).json({
      error: 'Model returned non-JSON response',
      raw,
      model: result.model,
    });
  }

  res.json({
    ...parsed,
    isConstituentOf,
    model: result.model,
    usage: result.usage,
    disclaimer:
      'AI-generated thesis fit score — not investment advice. '
    + 'Scores reflect the model\'s interpretation of the seeded thesis text, '
    + 'not financial analysis.',
  });
}));

export default router;
