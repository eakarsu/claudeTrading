import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { FiTrendingUp, FiCopy, FiRefreshCw, FiEye, FiBook, FiBell, FiZap, FiSearch,
  FiShield, FiBriefcase, FiSmile, FiLayers, FiRss, FiCpu, FiActivity, FiCalendar,
  FiBookOpen } from 'react-icons/fi';
import * as api from '../api';
import AIOutput from '../components/AIOutput';
import IndexMiniChart from '../components/IndexMiniChart';

const features = [
  { path: '/trailing-stops', icon: FiTrendingUp, label: 'Trailing Stops', color: '#10b981', desc: 'Dynamic stop losses that trail price up' },
  { path: '/copy-trades', icon: FiCopy, label: 'Copy Trading', color: '#8b5cf6', desc: 'Copy politician & whale trades' },
  { path: '/wheel-strategies', icon: FiRefreshCw, label: 'Wheel Strategy', color: '#f59e0b', desc: 'Sell puts & calls for premium income' },
  { path: '/watchlist', icon: FiEye, label: 'Watchlist', color: '#3b82f6', desc: 'Track stocks you\'re watching' },
  { path: '/trade-journal', icon: FiBook, label: 'Trade Journal', color: '#ec4899', desc: 'Log and review your trades' },
  { path: '/price-alerts', icon: FiBell, label: 'Price Alerts', color: '#ef4444', desc: 'Get notified at key price levels' },
  { path: '/trade-signals', icon: FiZap, label: 'Trade Signals', color: '#14b8a6', desc: 'AI-generated trading signals' },
  { path: '/stock-screener', icon: FiSearch, label: 'Stock Screener', color: '#6366f1', desc: 'AI-powered stock screening' },
  { path: '/risk-assessments', icon: FiShield, label: 'Risk Calculator', color: '#f97316', desc: 'Assess position risk levels' },
  { path: '/portfolio', icon: FiBriefcase, label: 'Portfolio', color: '#06b6d4', desc: 'Manage your holdings' },
  { path: '/sentiment', icon: FiSmile, label: 'Sentiment', color: '#a855f7', desc: 'Market sentiment analysis' },
  { path: '/options-chain', icon: FiLayers, label: 'Options Chain', color: '#eab308', desc: 'Analyze options data' },
  { path: '/market-news', icon: FiRss, label: 'Market News', color: '#22c55e', desc: 'AI-analyzed market news' },
  { path: '/ai-center', icon: FiCpu, label: 'AI Center', color: '#e11d48', desc: 'All AI tools in one place' },
  { path: '/docs', icon: FiBookOpen, label: 'Docs', color: '#64748b', desc: 'Freqtrade reference, searchable with AI' },
];

// Major-indices strip mirrors TradingView's "Indices" watchlist: SPX, NDQ,
// DJI, VIX, DXY. These are actual index levels (not ETF proxies) served by
// the server via Yahoo Finance — Alpaca can't quote indices.
const INDEX_TICKERS = ['SPX', 'NDQ', 'DJI', 'VIX', 'DXY'];

export default function Dashboard() {
  const navigate = useNavigate();
  const [marketAI, setMarketAI] = useState(null);
  const [aiLoading, setAiLoading] = useState(false);
  const [stats, setStats] = useState({});
  // Widget data. Each block is fetched independently and tolerant of errors
  // so a single 500 doesn't nuke the whole dashboard render.
  const [auto, setAuto]         = useState(null);
  const [recentTrades, setRecentTrades]  = useState([]);
  const [upcomingEvents, setUpcomingEvents] = useState([]);
  // Indices payload shape (from /market-data/indices):
  //   { SPX: { ticker, name, quote: { price, previousClose, time }, bars }, ... }
  const [indices, setIndices] = useState({});
  const [indicesStale, setIndicesStale] = useState(false);

  useEffect(() => {
    async function loadStats() {
      try {
        const [portfolio, signals, alerts] = await Promise.all([
          api.getAll('portfolio'),
          api.getAll('trade-signals'),
          api.getAll('price-alerts'),
        ]);
        const totalPnl = portfolio.reduce((sum, p) => sum + (p.pnl || 0), 0);
        const totalValue = portfolio.reduce((sum, p) => sum + (p.currentPrice * p.qty || 0), 0);
        setStats({
          totalValue: totalValue.toFixed(2),
          totalPnl: totalPnl.toFixed(2),
          activeSignals: signals.filter(s => s.status === 'active').length,
          activeAlerts: alerts.filter(a => a.status === 'active').length,
        });
      } catch (err) {
        console.error(err);
      }
    }
    async function loadWidgets() {
      // Auto-trader status.
      try { setAuto(await api.getAutoTraderStatus()); }
      catch { setAuto(null); }
      // Recent auto-trader trades (last 5).
      try {
        const { items } = await api.listAutoTraderTrades({ limit: 5 });
        setRecentTrades(items);
      } catch { setRecentTrades([]); }
      // Upcoming macro/earnings events — next 14 days.
      try {
        const today = new Date();
        const end   = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000);
        const iso = (d) => d.toISOString().slice(0, 10);
        const events = await api.getEventCalendar({ start: iso(today), end: iso(end) });
        setUpcomingEvents(events.slice(0, 8));
      } catch { setUpcomingEvents([]); }
    }
    async function loadIndices() {
      try {
        const payload = await api.getIndices();
        setIndices(payload || {});
        // If every ticker came back without a price, mark stale (upstream hiccup
        // or cold cache before market open). Still render cells so the layout
        // doesn't collapse.
        const anyPriced = INDEX_TICKERS.some(
          (t) => Number.isFinite(payload?.[t]?.quote?.price),
        );
        setIndicesStale(!anyPriced);
      } catch {
        setIndicesStale(true);
      }
    }
    loadStats();
    loadWidgets();
    loadIndices();
    // Poll every 60s. The server caches Yahoo responses for ~60s for quotes
    // and ~2min for bars, so even if many clients poll simultaneously there
    // is at most one upstream request per cache window.
    const t = setInterval(loadIndices, 60_000);
    return () => clearInterval(t);
  }, []);

  const handleMarketSummary = async () => {
    setAiLoading(true);
    try {
      const result = await api.aiMarketSummary();
      setMarketAI(result);
    } catch (err) {
      setMarketAI({ analysis: `Error: ${err.message}` });
    }
    setAiLoading(false);
  };

  return (
    <div className="feature-page">
      <div className="page-header">
        <h1>Dashboard</h1>
        <button className="btn btn-ai" onClick={handleMarketSummary} disabled={aiLoading}>
          <FiCpu size={16} /> AI Market Summary
        </button>
      </div>

      {/* Major indices strip with daily charts (1-day candles, ~1y lookback).
          Quote price + previousClose drive the session change display; the
          line shows the full-year trend, primarily from Alpaca ETF proxies. */}
      <div
        className="card-grid"
        style={{
          gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
          gap: 12,
          marginBottom: 12,
        }}
      >
        {INDEX_TICKERS.map((ticker) => {
          const row = indices[ticker];
          const price = row?.quote?.price;
          const prev = row?.quote?.previousClose;
          const bars = Array.isArray(row?.bars) ? row.bars : [];
          // Session change is (last - prev close) / prev close. We prefer the
          // meta previousClose over first-bar because Yahoo's first intraday
          // bar can print a few cents off the true open for indices like VIX.
          const diff =
            Number.isFinite(price) && Number.isFinite(prev) && prev !== 0
              ? price - prev
              : null;
          const change = diff != null ? (diff / prev) * 100 : null;
          const up = change == null ? null : change >= 0;
          // Index levels vary wildly in magnitude (VIX ~17, DJI ~49,000). Use
          // toLocaleString so big numbers get thousand separators and VIX/DXY
          // keep 2 decimals without trailing zeros elsewhere.
          const fmtPrice = (v) =>
            v >= 1000
              ? v.toLocaleString(undefined, { maximumFractionDigits: 2 })
              : v.toFixed(2);
          return (
            <div key={ticker} className="card" style={{ padding: 12 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                <div>
                  <div style={{ fontWeight: 600, color: '#e5e7eb' }}>{ticker}</div>
                  <div style={{ fontSize: 11, color: '#777' }}>{row?.name || ''}</div>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <div style={{ fontSize: 16, fontWeight: 600, color: '#e5e7eb' }}>
                    {Number.isFinite(price)
                      ? fmtPrice(price)
                      : <span style={{ color: '#888' }}>—</span>}
                  </div>
                  {change != null && (
                    <div style={{ fontSize: 12, color: up ? '#10b981' : '#ef4444' }}>
                      {up ? '▲' : '▼'} {diff >= 0 ? '+' : ''}{diff.toFixed(2)} ({Math.abs(change).toFixed(2)}%)
                    </div>
                  )}
                </div>
              </div>
              <div style={{ marginTop: 6 }}>
                {bars.length > 1 ? (
                  <IndexMiniChart bars={bars} height={90} />
                ) : (
                  <div style={{ height: 90, display: 'flex', alignItems: 'center',
                                justifyContent: 'center', color: '#666', fontSize: 12 }}>
                    No bars
                  </div>
                )}
              </div>
            </div>
          );
        })}
        {indicesStale && (
          <div className="card" style={{ padding: 12, display: 'flex', alignItems: 'center',
                                          justifyContent: 'center' }}>
            <span style={{ color: '#c84', fontSize: 12 }}>Live quotes unavailable</span>
          </div>
        )}
      </div>

      <div className="stats-row">
        <div className="stat-card">
          <span className="stat-label">Portfolio Value</span>
          <span className="stat-value">${Number(stats.totalValue || 0).toLocaleString()}</span>
        </div>
        <div className="stat-card">
          <span className="stat-label">Total P&L</span>
          <span className={`stat-value ${Number(stats.totalPnl) >= 0 ? 'positive' : 'negative'}`}>
            ${Number(stats.totalPnl || 0).toLocaleString()}
          </span>
        </div>
        <div className="stat-card">
          <span className="stat-label">Active Signals</span>
          <span className="stat-value">{stats.activeSignals || 0}</span>
        </div>
        <div className="stat-card">
          <span className="stat-label">Active Alerts</span>
          <span className="stat-value">{stats.activeAlerts || 0}</span>
        </div>
      </div>

      <AIOutput content={marketAI?.analysis} loading={aiLoading} model={marketAI?.model} usage={marketAI?.usage} />

      <div className="card-grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 12, marginTop: 12 }}>
        {/* Auto-trader status — live indicator of whether the bot is running. */}
        <div className="card" style={{ padding: 14 }}>
          <h3 style={{ margin: 0, display: 'flex', alignItems: 'center', gap: 8 }}>
            <FiActivity /> Auto-Trader
          </h3>
          {!auto ? (
            <p style={{ color: '#888' }}>Status unavailable.</p>
          ) : auto.running ? (
            <>
              <p style={{ color: '#4c4', marginBottom: 4 }}>Running · {auto.strategy || '—'}</p>
              <p style={{ color: '#aaa', marginTop: 0, fontSize: 13 }}>
                {(auto.symbols || []).join(', ') || 'no symbols'}
              </p>
              <p style={{ color: '#888', fontSize: 12 }}>
                Last tick: {auto.lastTickAt ? new Date(auto.lastTickAt).toLocaleTimeString() : '—'}
              </p>
            </>
          ) : (
            <p style={{ color: '#c84' }}>Stopped.</p>
          )}
        </div>

        {/* Latest auto-trader trades — quick recency glance + link to replay. */}
        <div className="card" style={{ padding: 14 }}>
          <h3 style={{ margin: 0 }}>Recent Trades</h3>
          {recentTrades.length === 0
            ? <p style={{ color: '#888' }}>No auto-trader trades yet.</p>
            : recentTrades.map((t) => (
                <div key={t.id} onClick={() => navigate('/trade-replay')}
                     style={{ display: 'flex', justifyContent: 'space-between', cursor: 'pointer',
                              padding: '4px 0', borderBottom: '1px solid #222', fontSize: 13 }}>
                  <span>
                    <strong>{t.symbol}</strong>{' '}
                    <span style={{ color: t.action === 'buy' ? '#6d6' : '#e66' }}>{t.action}</span>
                  </span>
                  <span style={{ color: '#888' }}>{new Date(t.createdAt).toLocaleDateString()}</span>
                </div>
              ))
          }
        </div>

        {/* Next 14 days of macro + earnings events — blackout visibility. */}
        <div className="card" style={{ padding: 14 }}>
          <h3 style={{ margin: 0, display: 'flex', alignItems: 'center', gap: 8 }}>
            <FiCalendar /> Upcoming Events
          </h3>
          {upcomingEvents.length === 0
            ? <p style={{ color: '#888' }}>No events in the next 14 days.</p>
            : upcomingEvents.map((e, i) => (
                <div key={i} style={{ padding: '3px 0', borderBottom: '1px solid #222', fontSize: 13 }}>
                  <strong>{e.date}</strong>{' '}
                  <span style={{ color: '#fc4', textTransform: 'uppercase' }}>{e.kind}</span>{' '}
                  {e.symbol && <span style={{ color: '#aaf' }}>{e.symbol}</span>}{' '}
                  <span style={{ color: '#888' }}>{e.note || ''}</span>
                </div>
              ))
          }
        </div>
      </div>

      <h2 className="section-title">Features</h2>
      <div className="card-grid dashboard-grid">
        {features.map(({ path, icon: Icon, label, color, desc }) => (
          <div key={path} className="card dashboard-card" onClick={() => navigate(path)}>
            <div className="card-icon" style={{ background: color }}>
              <Icon size={24} color="#fff" />
            </div>
            <h3>{label}</h3>
            <p>{desc}</p>
          </div>
        ))}
      </div>
    </div>
  );
}
