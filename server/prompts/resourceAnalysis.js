/**
 * Per-resource AI-analysis prompt builders. Each takes the plain record and returns
 * the user-content string. Free-text fields go through sanitizeUserText to reduce
 * prompt-injection risk.
 */
import { sanitizeUserText } from '../services/promptSafety.js';

const s = (v) => sanitizeUserText(v, { maxLen: 500 });

export const resourcePrompts = {
  'trailing-stops': (item) =>
    `Analyze this trailing stop position: ${item.symbol} - Bought ${item.qty} shares at $${item.entryPrice}, current price $${item.currentPrice}, floor at $${item.floorPrice}, highest seen $${item.highestPrice}, stop loss ${item.stopLossPct}%, trail ${item.trailPct}%. Status: ${item.status}. Should I adjust the trailing stop parameters? What's the risk/reward outlook?`,

  'copy-trades': (item) =>
    `Analyze this politician copy trade: ${s(item.politician)} ${item.action} ${item.qty} shares of ${item.symbol} at $${item.price} on ${item.tradeDate} (total: $${item.totalValue}). Status: ${item.status}. What might this politician know? Should I follow this trade? What are the risks of copying politician trades?`,

  'wheel-strategies': (item) =>
    `Analyze this wheel strategy position: ${item.symbol} - Stage: ${item.stage}, Strike: $${item.strikePrice}, Expiration: ${item.expiration}, Premium: $${item.premium}, Cost basis: $${item.costBasis}, Contracts: ${item.contracts}. Status: ${item.status}. Should I roll this option? What's the optimal next move in the wheel?`,

  'watchlist': (item) =>
    `Analyze ${item.symbol} (${s(item.companyName)}) for my watchlist: Price $${item.price}, Change ${item.changePct}%, Volume ${item.volume}, Sector: ${s(item.sector)}. Notes: ${s(item.notes)}. Is this a good entry point? What catalysts should I watch for?`,

  'trade-journal': (item) =>
    `Review this trade from my journal: ${item.action} ${item.qty} shares of ${item.symbol} at $${item.entryPrice}, exited at $${item.exitPrice} on ${item.tradeDate}. P&L: $${item.pnl}. Strategy: ${s(item.strategy)}. Notes: ${s(item.notes)}. What did I do right or wrong? How can I improve this strategy?`,

  'price-alerts': (item) =>
    `Analyze this price alert: ${item.symbol} target $${item.targetPrice} (${item.direction}), current price $${item.currentPrice}. Notes: ${s(item.notes)}. Status: ${item.status}. Is this alert level significant from a technical analysis perspective? What might happen when this price is reached?`,

  'trade-signals': (item) =>
    `Evaluate this trade signal: ${item.symbol} - ${item.signalType} signal with ${(item.confidence * 100).toFixed(0)}% confidence. Entry: $${item.entryPrice}, Target: $${item.targetPrice}, Stop: $${item.stopPrice}. Timeframe: ${item.timeframe}. Is this signal reliable? What's the risk/reward ratio? What additional confirmation should I look for?`,

  'stock-screener': (item) =>
    `Analyze ${item.symbol} (${s(item.companyName)}): Sector ${s(item.sector)}, Market Cap ${item.marketCap}, P/E ${item.peRatio}, Dividend Yield ${item.dividendYield}%, AI Score ${item.aiScore}/10. Is this stock undervalued or overvalued? What are the key growth drivers and risks?`,

  'risk-assessments': (item) =>
    `Assess the risk for this position: ${item.symbol} - Position size $${item.positionSize}, Risk level: ${item.riskLevel}, Max loss $${item.maxLoss}, Risk/Reward ${item.riskRewardRatio}, Volatility ${item.volatility}%. Notes: ${s(item.notes)}. Is this position sized correctly? What hedging strategies would you recommend?`,

  'portfolio': (item) =>
    `Analyze this portfolio holding: ${item.symbol} (${s(item.companyName)}) - ${item.qty} shares at avg $${item.avgPrice}, current $${item.currentPrice}, P&L $${item.pnl}, Allocation ${item.allocation}%. Should I rebalance? Is this position too concentrated or too small?`,

  'sentiment': (item) =>
    `Analyze the market sentiment for ${item.symbol}: Score ${item.sentimentScore}, Source: ${s(item.source)}, Headline: "${s(item.headline)}", Bullish ${item.bullishPct}% / Bearish ${item.bearishPct}%. Is the sentiment justified? How should this affect my trading decisions?`,

  'options-chain': (item) =>
    `Analyze this option: ${item.symbol} ${item.optionType} strike $${item.strike}, exp ${item.expiration}, premium $${item.premium}, IV ${item.iv}%, delta ${item.delta}, OI ${item.openInterest}. Is this option fairly priced? What strategy would you recommend with this option?`,

  'market-news': (item) =>
    `Analyze this market news for trading impact: "${s(item.title)}" - ${s(item.summary)}. Source: ${s(item.source)}. Related symbol: ${item.symbol}. Sentiment: ${item.sentiment}. Published: ${item.publishedAt}. How should traders react? What are the short and long term implications?`,
};
