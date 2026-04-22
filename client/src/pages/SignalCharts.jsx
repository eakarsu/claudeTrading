import React, { useState, useEffect } from 'react';
import { FiTrendingUp, FiTrendingDown, FiMinus, FiCpu } from 'react-icons/fi';
import * as api from '../api';
import TradingChart from '../components/TradingChart';
import AIOutput from '../components/AIOutput';

const SIGNAL_COLORS = { bullish: '#10b981', bearish: '#ef4444', neutral: '#f59e0b' };
const SIGNAL_ICONS = { bullish: FiTrendingUp, bearish: FiTrendingDown, neutral: FiMinus };
const SIGNAL_DESCRIPTIONS = {
  bullish: {
    title: 'Buy Signal (Bullish)',
    desc: 'Price is expected to move UP. Enter a long position at the entry price, set stop loss below support, and take profit at target. Higher confidence = stronger upward momentum.',
  },
  bearish: {
    title: 'Sell Signal (Bearish)',
    desc: 'Price is expected to move DOWN. Consider shorting or closing long positions at the entry price. Stop loss above resistance, target at lower support level.',
  },
  neutral: {
    title: 'Neutral Signal (Hold)',
    desc: 'No clear directional bias. Price is in a consolidation range. Wait for a breakout above or below key levels before taking a position. Tight stops recommended.',
  },
};

const STRATEGY_DESCRIPTIONS = {
  'MACD Crossover': 'MACD line crosses above the signal line, indicating bullish momentum shift. Best confirmed with rising volume.',
  'Golden Cross': '50-day moving average crosses above 200-day MA. Strong long-term bullish signal, often starts a major uptrend.',
  'Death Cross': '50-day moving average crosses below 200-day MA. Bearish signal warning of potential extended downtrend.',
  'EMA Bounce': 'Price bounces off a key exponential moving average (20/50 EMA), confirming the trend remains intact.',
  'RSI Oversold Bounce': 'RSI drops below 30 then reverses up. Indicates selling exhaustion and potential reversal to the upside.',
  'RSI Overbought': 'RSI rises above 70, signaling price may be stretched too far. Watch for bearish divergence.',
  'Bollinger Squeeze': 'Bollinger Bands tighten to their narrowest, signaling an explosive move is coming. Direction TBD.',
  'Bollinger Band Bounce': 'Price touches the lower Bollinger Band and reverses. Often a mean-reversion buy signal.',
  'Support Bounce': 'Price tests a major support level and bounces. Key level held = continuation of uptrend.',
  'Resistance Rejection': 'Price fails to break above resistance. Sellers defending the level = potential reversal down.',
  'Breakout': 'Price breaks above a key resistance level with volume. Often starts a new leg up.',
  'Breakdown': 'Price breaks below support with increasing volume. Signals further downside ahead.',
  'Volume Breakout': 'Price breaks a key level accompanied by unusually high volume, confirming conviction behind the move.',
  'Cup & Handle': 'U-shaped recovery followed by a small pullback. Classic bullish continuation pattern with high win rate.',
  'Head & Shoulders': 'Three-peak pattern with the middle peak highest. Bearish reversal signal when neckline breaks.',
  'Double Bottom': 'Price tests the same support level twice and bounces. W-shaped bullish reversal pattern.',
  'Double Top': 'Price fails at the same resistance twice. M-shaped bearish reversal pattern.',
  'Bull Flag': 'Sharp rally followed by a tight downward consolidation. Bullish continuation — expect another leg up.',
  'Bear Flag': 'Sharp decline followed by a slight upward drift. Bearish continuation — expect another leg down.',
  'Ascending Triangle': 'Higher lows pushing into flat resistance. Bullish pattern that usually breaks to the upside.',
  'Fibonacci Retracement': 'Price pulls back to a key Fibonacci level (38.2%, 50%, or 61.8%) and bounces. Classic trend continuation entry.',
  'VWAP Bounce': 'Price bounces off the Volume Weighted Average Price. Institutional traders use VWAP as key intraday support.',
  'Stochastic Crossover': 'Stochastic %K crosses above %D in oversold territory. Momentum shifting from bearish to bullish.',
  'Ichimoku Cloud': 'Price entering or exiting the Ichimoku Cloud. Above = bullish, below = bearish, inside = neutral/uncertain.',
  'Range Bound': 'Price oscillating between clear support and resistance. Trade the range or wait for breakout.',
};

const LIVE_ACTION_LABELS = {
  strong_buy: { text: 'STRONG BUY', color: '#10b981', bg: 'rgba(16,185,129,0.15)' },
  hold_long: { text: 'HOLD LONG', color: '#3b82f6', bg: 'rgba(59,130,246,0.15)' },
  take_profit: { text: 'TAKE PROFIT', color: '#f59e0b', bg: 'rgba(245,158,11,0.15)' },
  stopped_out: { text: 'STOPPED OUT', color: '#ef4444', bg: 'rgba(239,68,68,0.15)' },
  strong_sell: { text: 'STRONG SELL', color: '#ef4444', bg: 'rgba(239,68,68,0.15)' },
  hold_short: { text: 'HOLD SHORT', color: '#8b5cf6', bg: 'rgba(139,92,246,0.15)' },
  buy: { text: 'BUY', color: '#10b981', bg: 'rgba(16,185,129,0.15)' },
  sell: { text: 'SELL', color: '#ef4444', bg: 'rgba(239,68,68,0.15)' },
  hold: { text: 'HOLD', color: '#f59e0b', bg: 'rgba(245,158,11,0.15)' },
};

export default function SignalCharts() {
  // Base signals (loaded once, drives charts - does NOT change on refresh)
  const [signals, setSignals] = useState([]);
  // Live overlay data (updates every 30s, does NOT cause chart re-render)
  const [livePrices, setLivePrices] = useState({});
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('all');
  const [marketOpen, setMarketOpen] = useState(false);
  const [isLive, setIsLive] = useState(false);
  const [chartInterval, setChartInterval] = useState('1Day');
  const [aiResult, setAiResult] = useState(null);
  const [aiLoading, setAiLoading] = useState(false);

  // Load base signals once
  const loadSignals = () => {
    setLoading(true);
    api.getLiveSignals().then((result) => {
      const sorted = (result.signals || []).sort((a, b) => (b.confidence || 0) - (a.confidence || 0));
      setSignals(sorted);
      setIsLive(result.live === true);
      setMarketOpen(result.market === 'open');
      if (result.market === 'open') setChartInterval('5Min');
      // Extract live prices into separate state
      const prices = {};
      sorted.forEach(s => {
        if (s.livePrice) {
          prices[s.id] = { livePrice: s.livePrice, liveAction: s.liveAction, distFromEntry: s.distFromEntry, distToTarget: s.distToTarget, distToStop: s.distToStop };
        }
      });
      setLivePrices(prices);
      setLoading(false);
    }).catch(() => {
      api.getAll('trade-signals').then((data) => {
        setSignals(data.sort((a, b) => (b.confidence || 0) - (a.confidence || 0)));
        setLoading(false);
      }).catch(() => setLoading(false));
    });
  };

  // Refresh only live prices (not base signals) every 30s
  const refreshLivePrices = () => {
    api.getLiveSignals().then((result) => {
      if (!result.live) return;
      const prices = {};
      (result.signals || []).forEach(s => {
        if (s.livePrice) {
          prices[s.id] = { livePrice: s.livePrice, liveAction: s.liveAction, distFromEntry: s.distFromEntry, distToTarget: s.distToTarget, distToStop: s.distToStop };
        }
      });
      setLivePrices(prices);
      setIsLive(true);
    }).catch(() => {});
  };

  useEffect(() => {
    loadSignals();
  }, []);

  useEffect(() => {
    if (!marketOpen) return;
    const interval = setInterval(refreshLivePrices, 30000);
    return () => clearInterval(interval);
  }, [marketOpen]);

  const handleAIOverview = async () => {
    setAiLoading(true);
    setAiResult(null);
    const signalList = signals.map(s =>
      `${s.symbol}: ${s.signalType} (${(s.confidence * 100).toFixed(0)}% conf) Entry $${s.entryPrice} Target $${s.targetPrice} Stop $${s.stopPrice} [${s.timeframe}]`
    ).join('\n');
    try {
      const result = await api.askFeatureAI('trade-signals',
        `Here are ALL my active trading signals:\n${signalList}\n\nAnalyze all signals together. For each one, tell me: 1) BUY or SELL recommendation 2) Best entry point 3) Most probable price targets. Then rank them from strongest to weakest signal. Which trades should I take NOW and which should I wait on?`
      );
      setAiResult(result);
    } catch (err) {
      setAiResult({ analysis: `Error: ${err.message}` });
    }
    setAiLoading(false);
  };

  if (loading) return <div className="feature-page"><div className="loading-state">Loading signals...</div></div>;

  const bullish = signals.filter(s => s.signalType === 'bullish');
  const bearish = signals.filter(s => s.signalType === 'bearish');
  const neutral = signals.filter(s => s.signalType === 'neutral');
  const filtered = filter === 'all' ? signals
    : filter.startsWith('id-') ? signals.filter(s => s.id === Number(filter.replace('id-', '')))
    : filter.startsWith('strat-') ? signals.filter(s => s.strategy === filter.replace('strat-', ''))
    : signals.filter(s => s.signalType === filter);

  return (
    <div className="feature-page">
      <div className="page-header">
        <h1>
          Signal Charts
          {isLive && <span className="live-badge">LIVE</span>}
          {!isLive && marketOpen && <span className="live-badge delayed">DELAYED</span>}
        </h1>
        <div className="page-actions">
          <select className="signal-filter-select" value={chartInterval} onChange={(e) => setChartInterval(e.target.value)}>
            <option value="1Min">1 Min</option>
            <option value="5Min">5 Min</option>
            <option value="15Min">15 Min</option>
            <option value="1H">1 Hour</option>
            <option value="4H">4 Hour</option>
            <option value="1Day">Daily</option>
          </select>
          <select className="signal-filter-select" value={filter} onChange={(e) => setFilter(e.target.value)}>
            <option value="all">All Signals ({signals.length})</option>
            <option disabled>── By Direction ──</option>
            <option value="bullish">Buy Signals ({bullish.length})</option>
            <option value="bearish">Sell Signals ({bearish.length})</option>
            <option value="neutral">Neutral ({neutral.length})</option>
            <option disabled>── By Strategy ──</option>
            {[...new Set(signals.map(s => s.strategy).filter(Boolean))].sort().map((strat) => (
              <option key={strat} value={`strat-${strat}`}>
                {strat} ({signals.filter(s => s.strategy === strat).length})
              </option>
            ))}
            <option disabled>── Individual Signals ──</option>
            {signals.map((s) => (
              <option key={s.id} value={`id-${s.id}`}>
                {s.symbol} — {s.strategy || s.signalType.toUpperCase()} ({(s.confidence * 100).toFixed(0)}%)
              </option>
            ))}
          </select>
          <button className="btn btn-ai" onClick={handleAIOverview} disabled={aiLoading}>
            <FiCpu size={16} /> AI: Analyze All Signals
          </button>
        </div>
      </div>

      {/* Summary Stats */}
      <div className="signal-summary-row">
        <div className="signal-summary-stat">
          <FiTrendingUp size={18} color="#10b981" />
          <span className="summary-count" style={{ color: '#10b981' }}>{bullish.length}</span>
          <span className="summary-label">Buy Signals</span>
        </div>
        <div className="signal-summary-stat">
          <FiTrendingDown size={18} color="#ef4444" />
          <span className="summary-count" style={{ color: '#ef4444' }}>{bearish.length}</span>
          <span className="summary-label">Sell Signals</span>
        </div>
        <div className="signal-summary-stat">
          <FiMinus size={18} color="#f59e0b" />
          <span className="summary-count" style={{ color: '#f59e0b' }}>{neutral.length}</span>
          <span className="summary-label">Neutral</span>
        </div>
        <div className="signal-summary-stat">
          <span className="summary-count" style={{ color: '#818cf8' }}>{signals.length}</span>
          <span className="summary-label">Total Signals</span>
        </div>
      </div>

      {/* Signal Type Description */}
      {filter !== 'all' && !filter.startsWith('id-') && SIGNAL_DESCRIPTIONS[filter] && (
        <div className="signal-type-desc" style={{ borderLeftColor: SIGNAL_COLORS[filter] }}>
          <div className="signal-type-title" style={{ color: SIGNAL_COLORS[filter] }}>
            {React.createElement(SIGNAL_ICONS[filter], { size: 16 })}
            {SIGNAL_DESCRIPTIONS[filter].title}
          </div>
          <div className="signal-type-text">{SIGNAL_DESCRIPTIONS[filter].desc}</div>
        </div>
      )}
      {filter.startsWith('strat-') && STRATEGY_DESCRIPTIONS[filter.replace('strat-', '')] && (
        <div className="signal-type-desc" style={{ borderLeftColor: '#818cf8' }}>
          <div className="signal-type-title" style={{ color: '#818cf8' }}>
            {filter.replace('strat-', '')}
          </div>
          <div className="signal-type-text">{STRATEGY_DESCRIPTIONS[filter.replace('strat-', '')]}</div>
        </div>
      )}

      {/* AI Analysis */}
      <AIOutput
        content={aiResult?.analysis}
        loading={aiLoading}
        model={aiResult?.model}
        usage={aiResult?.usage}
      />

      {/* All Signal Charts */}
      {filtered.length === 0 ? (
        <div className="empty-state">{signals.length === 0 ? 'No trade signals yet. Add signals in the Trade Signals page first.' : 'No signals match this filter.'}</div>
      ) : (
        <div className="signal-all-charts">
          {filtered.map((s) => {
            const Icon = SIGNAL_ICONS[s.signalType] || FiMinus;
            const color = SIGNAL_COLORS[s.signalType];
            const isBull = s.signalType === 'bullish';
            const isBear = s.signalType === 'bearish';
            const rr = (Math.abs(s.targetPrice - s.entryPrice) / Math.abs(s.entryPrice - s.stopPrice)) || 0;
            const profitPct = isBull
              ? ((s.targetPrice - s.entryPrice) / s.entryPrice * 100)
              : ((s.entryPrice - s.targetPrice) / s.entryPrice * 100);
            const lossPct = isBull
              ? ((s.entryPrice - s.stopPrice) / s.entryPrice * 100)
              : ((s.stopPrice - s.entryPrice) / s.entryPrice * 100);

            const live = livePrices[s.id];
            const liveLabel = live?.liveAction ? LIVE_ACTION_LABELS[live.liveAction] : null;

            return (
              <div key={s.id} className="signal-chart-block">
                {/* Signal Header */}
                <div className="signal-block-header">
                  <div className="signal-block-left">
                    <Icon size={20} color={color} />
                    <span className="signal-block-symbol">{s.symbol}</span>
                    {liveLabel ? (
                      <span className="signal-block-live-action" style={{ background: liveLabel.bg, color: liveLabel.color }}>
                        {liveLabel.text}
                      </span>
                    ) : (
                      <span className="signal-block-type" style={{ background: color }}>
                        {isBull ? 'BUY' : isBear ? 'SELL' : 'HOLD'}
                      </span>
                    )}
                    {s.strategy && <span className="signal-block-strategy">{s.strategy}</span>}
                    <span className="signal-block-conf" style={{ color }}>
                      {(s.confidence * 100).toFixed(0)}%
                    </span>
                  </div>
                  <div className="signal-block-right">
                    {live?.livePrice && (
                      <span className="signal-block-live-price">
                        Live: ${live.livePrice.toFixed(2)}
                      </span>
                    )}
                    <span className="signal-block-tf">{s.timeframe}</span>
                  </div>
                </div>

                {/* Price Levels */}
                {/* Signal Description */}
                <div className="signal-block-desc">
                  <strong>{s.strategy || s.signalType}:</strong>{' '}
                  {STRATEGY_DESCRIPTIONS[s.strategy] || (isBull
                    ? `Bullish momentum detected. Buy at $${s.entryPrice?.toFixed(2)}, target +${profitPct.toFixed(1)}% upside.`
                    : isBear
                    ? `Bearish pressure detected. Short at $${s.entryPrice?.toFixed(2)}, target -${profitPct.toFixed(1)}% drop.`
                    : `Consolidating in range. Wait for breakout confirmation.`)}
                  {' '}{isBull ? `Entry $${s.entryPrice?.toFixed(2)} → Target $${s.targetPrice?.toFixed(2)} (+${profitPct.toFixed(1)}%)` : isBear ? `Entry $${s.entryPrice?.toFixed(2)} → Target $${s.targetPrice?.toFixed(2)} (-${profitPct.toFixed(1)}%)` : ''}
                </div>

                <div className="signal-block-prices">
                  <div className="signal-price-tag entry">
                    <span className="tag-label">{isBear ? 'Short Entry' : 'Buy Entry'}</span>
                    <span className="tag-value">${s.entryPrice?.toFixed(2)}</span>
                  </div>
                  <div className="signal-price-tag target">
                    <span className="tag-label">Target</span>
                    <span className="tag-value">${s.targetPrice?.toFixed(2)}</span>
                    <span className="tag-pct">+{profitPct.toFixed(1)}%</span>
                  </div>
                  <div className="signal-price-tag stop">
                    <span className="tag-label">Stop Loss</span>
                    <span className="tag-value">${s.stopPrice?.toFixed(2)}</span>
                    <span className="tag-pct">-{lossPct.toFixed(1)}%</span>
                  </div>
                  <div className="signal-price-tag rr">
                    <span className="tag-label">Risk/Reward</span>
                    <span className="tag-value">1:{rr.toFixed(1)}</span>
                  </div>
                  {live?.livePrice && (
                    <div className="signal-price-tag live">
                      <span className="tag-label">Live Price</span>
                      <span className="tag-value">${live.livePrice.toFixed(2)}</span>
                      <span className="tag-pct" style={{ color: live.distFromEntry >= 0 ? '#10b981' : '#ef4444' }}>
                        {live.distFromEntry >= 0 ? '+' : ''}{live.distFromEntry}% from entry
                      </span>
                    </div>
                  )}
                </div>

                {/* Chart */}
                <TradingChart
                  symbol={s.symbol}
                  params={{
                    entryPrice: s.entryPrice,
                    targetPrice: s.targetPrice,
                    stopPrice: s.stopPrice,
                    action: isBull ? 'buy' : 'sell',
                    entryAt: s.createdAt || s.signalTime,
                  }}
                  height={300}
                  chartKey={`signal-all-${s.symbol}-${s.id}`}
                  resource="trade-signals"
                  forceInterval={chartInterval}
                />
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
