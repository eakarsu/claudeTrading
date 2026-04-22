import React, { useState, useEffect, useCallback } from 'react';
import { getStrategies, backtestAll, backtestMulti, comboBacktest, comboBacktestMulti, startAutoTrader, stopAutoTrader, getAutoTraderStatus, alpacaPositions, alpacaAccount, updateAutoTraderTradeTags, journalAutoTraderTrade, getHvRank, listThemes } from '../api';
import { FiPlay, FiSquare, FiTrendingUp, FiTrendingDown, FiActivity, FiZap, FiTarget, FiBarChart2, FiCheck, FiCheckSquare, FiSearch, FiAlertTriangle, FiBook, FiChevronDown, FiChevronRight } from 'react-icons/fi';
import EquityCurveChart from '../components/EquityCurveChart';
import DrawdownChart from '../components/DrawdownChart';
import DocsHint from '../components/DocsHint';

const DEFAULT_SYMBOLS = ['AAPL', 'TSLA', 'NVDA', 'MSFT', 'AMZN', 'GOOG', 'META', 'AMD', 'NFLX', 'CRM'];
const DAYS_OPTIONS = [90, 180, 365];

export default function StrategyLab() {
  const [strategies, setStrategies] = useState([]);
  const [selectedStrategies, setSelectedStrategies] = useState([]);
  const [symbol, setSymbol] = useState('TSLA');
  const [days, setDays] = useState(365);
  const [results, setResults] = useState(null);
  const [multiResults, setMultiResults] = useState(null);
  const [loading, setLoading] = useState(false);
  const [multiLoading, setMultiLoading] = useState(false);
  const [comboResults, setComboResults] = useState(null);
  const [comboLoading, setComboLoading] = useState(false);
  const [tab, setTab] = useState('combo'); // combo, single, multi, auto
  // AI Theme basket override — when set, the multi-symbol backtest uses the
  // theme's constituents instead of DEFAULT_SYMBOLS. Themes are fetched on
  // mount; unset = fall back to the original default universe.
  const [themes, setThemes] = useState([]);
  const [multiThemeSlug, setMultiThemeSlug] = useState('');
  useEffect(() => {
    listThemes().then((r) => setThemes(r.items || [])).catch(() => {});
  }, []);
  const multiSymbols = React.useMemo(() => {
    if (!multiThemeSlug) return DEFAULT_SYMBOLS;
    const t = themes.find((x) => x.slug === multiThemeSlug);
    return t?.constituents?.length
      ? t.constituents.map((c) => c.symbol)
      : DEFAULT_SYMBOLS;
  }, [multiThemeSlug, themes]);
  const [backtestTimeframe, setBacktestTimeframe] = useState('1Day');
  const [autoStatus, setAutoStatus] = useState(null);
  const [autoStrategy, setAutoStrategy] = useState('');
  const [autoSymbols, setAutoSymbols] = useState('TSLA,AAPL,NVDA,MSFT,AMZN');
  const [autoTimeframe, setAutoTimeframe] = useState('1Day');
  const [autoRiskPerTrade, setAutoRiskPerTrade] = useState('');
  const [autoUseBracket, setAutoUseBracket] = useState(true);
  // Extra safety config
  const [autoAvoidFirstMin, setAutoAvoidFirstMin] = useState('');
  const [autoAvoidLastMin, setAutoAvoidLastMin] = useState('');
  const [autoFlattenOnClose, setAutoFlattenOnClose] = useState(false);
  const [autoMaxDailyTrades, setAutoMaxDailyTrades] = useState('');
  const [autoUseTrailing, setAutoUseTrailing] = useState(false);
  const [autoTrailingPct, setAutoTrailingPct] = useState('2');
  const [autoMinAdx, setAutoMinAdx] = useState('');
  // Scheduled trading window (minutes since session open). Blank = no gate.
  const [autoTradeStartMin, setAutoTradeStartMin] = useState('');
  const [autoTradeEndMin, setAutoTradeEndMin] = useState('');
  // Macro-event blackouts + ad-hoc skip dates (comma-separated YYYY-MM-DD).
  const [autoSkipFomc, setAutoSkipFomc] = useState(false);
  const [autoSkipCpi, setAutoSkipCpi] = useState(false);
  const [autoSkipNfp, setAutoSkipNfp] = useState(false);
  const [autoSkipEarnings, setAutoSkipEarnings] = useState(false);
  const [autoSkipDates, setAutoSkipDates] = useState('');
  // Per-symbol JSON overrides (merged into base config in the service).
  const [autoPerSymbolText, setAutoPerSymbolText] = useState('');
  // Live-mode confirmation — required when the server runs with ALPACA_LIVE_TRADING=true.
  const [autoLiveAck, setAutoLiveAck] = useState(false);
  // Cost / validation for backtests
  const [costSlippageBps, setCostSlippageBps] = useState('');   // basis points
  const [costCommission, setCostCommission] = useState('');    // $ per side
  const [costOosRatio, setCostOosRatio] = useState('');        // 0..0.5
  const [costMinAdx, setCostMinAdx] = useState('');
  const [hvInfo, setHvInfo] = useState(null);     // { hv, hvRank, interpretation }
  const [livePositions, setLivePositions] = useState([]);
  const [account, setAccount] = useState(null);
  const [error, setError] = useState('');

  // Clamp a numeric input to [min, max]; returns undefined for NaN/empty so we
  // can skip sending the field entirely instead of poisoning the backtest opts.
  const clamp = (raw, { min, max } = {}) => {
    const n = parseFloat(raw);
    if (!Number.isFinite(n)) return undefined;
    if (min != null && n < min) return min;
    if (max != null && n > max) return max;
    return n;
  };

  // Build the shared { slippagePct, commissionPerTrade, oosRatio, minAdx } object for backtest calls.
  const buildCostOpts = () => {
    const opts = {};
    // Slippage: up to 500 bps (5%) is a generous ceiling for equities backtests.
    const bps = clamp(costSlippageBps, { min: 0, max: 500 });
    if (bps != null && bps > 0) opts.slippagePct = bps / 10000;
    const comm = clamp(costCommission, { min: 0, max: 100 });
    if (comm != null && comm > 0) opts.commissionPerTrade = comm;
    const oos = clamp(costOosRatio, { min: 0, max: 0.5 });
    if (oos != null && oos > 0 && oos < 0.5) opts.oosRatio = oos;
    const adx = clamp(costMinAdx, { min: 0, max: 100 });
    if (adx != null && adx > 0) opts.minAdx = adx;
    return opts;
  };

  // Strict-ish ticker pattern: uppercase letters, optional dot (e.g. BRK.B), 1–6 chars.
  const SYMBOL_RE = /^[A-Z]{1,5}(?:\.[A-Z])?$/;

  useEffect(() => {
    getStrategies().then(list => {
      setStrategies(list);
      // Select all by default
      setSelectedStrategies(list.map(s => s.key));
    }).catch(() => {});
    refreshAutoStatus();
    // Pull account once for the PDT banner / day-trade count.
    alpacaAccount().then(setAccount).catch(() => {});
  }, []);

  const refreshAutoStatus = useCallback(async () => {
    try {
      const status = await getAutoTraderStatus();
      setAutoStatus(status);
    } catch (_) {}
  }, []);

  useEffect(() => {
    if (!autoStatus?.running) return;
    const timer = setInterval(refreshAutoStatus, 10000);
    return () => clearInterval(timer);
  }, [autoStatus?.running, refreshAutoStatus]);

  // Live positions poll — only while auto trader is running.
  useEffect(() => {
    if (!autoStatus?.running) { setLivePositions([]); return; }
    let cancelled = false;
    const pull = async () => {
      try {
        const data = await alpacaPositions();
        if (!cancelled) setLivePositions(Array.isArray(data) ? data : []);
      } catch (_) { /* ignore polling errors */ }
    };
    pull();
    const timer = setInterval(pull, 10000);
    return () => { cancelled = true; clearInterval(timer); };
  }, [autoStatus?.running]);

  // Prefill the auto-trader strategy from the most recent best backtest result.
  useEffect(() => {
    if (autoStrategy) return;
    if (multiResults?.ranking?.[0]?.strategyKey) {
      setAutoStrategy(multiResults.ranking[0].strategyKey);
    }
  }, [multiResults, autoStrategy]);

  const toggleStrategy = (key) => {
    setSelectedStrategies(prev =>
      prev.includes(key) ? prev.filter(k => k !== key) : [...prev, key]
    );
  };

  const selectAll = () => setSelectedStrategies(strategies.map(s => s.key));
  const selectNone = () => setSelectedStrategies([]);

  // Pull HV rank for the current symbol whenever it changes. We don't block
  // the backtest on this — it's a purely informational sidebar.
  useEffect(() => {
    const sym = symbol?.toUpperCase();
    if (!sym || !SYMBOL_RE.test(sym)) { setHvInfo(null); return; }
    let cancelled = false;
    getHvRank(sym).then((info) => {
      if (!cancelled) setHvInfo(info);
    }).catch(() => { if (!cancelled) setHvInfo(null); });
    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [symbol]);

  const runBacktest = async () => {
    if (!selectedStrategies.length) { setError('Select at least one strategy'); return; }
    setLoading(true);
    setError('');
    try {
      const filter = selectedStrategies.length < strategies.length ? selectedStrategies : null;
      const data = await backtestAll(symbol.toUpperCase(), days, filter, backtestTimeframe, buildCostOpts());
      setResults(data);
    } catch (err) {
      setError(err.message);
    }
    setLoading(false);
  };

  const runMultiBacktest = async () => {
    if (!selectedStrategies.length) { setError('Select at least one strategy'); return; }
    setMultiLoading(true);
    setError('');
    try {
      const filter = selectedStrategies.length < strategies.length ? selectedStrategies : null;
      const data = await backtestMulti(multiSymbols, days, filter, backtestTimeframe, buildCostOpts());
      setMultiResults(data);
    } catch (err) {
      setError(err.message);
    }
    setMultiLoading(false);
  };

  const runComboBacktest = async () => {
    if (!selectedStrategies.length) { setError('Select at least one strategy'); return; }
    setComboLoading(true);
    setError('');
    try {
      const data = await comboBacktest(symbol.toUpperCase(), selectedStrategies, days, backtestTimeframe, buildCostOpts());
      setComboResults(data);
    } catch (err) {
      setError(err.message);
    }
    setComboLoading(false);
  };

  const handleStartAuto = async () => {
    if (!autoStrategy) return;
    // Split, normalize, dedupe, and reject anything that doesn't look like a ticker.
    const rawSyms = autoSymbols.split(',').map(s => s.trim().toUpperCase()).filter(Boolean);
    const syms = [...new Set(rawSyms)].filter((s) => SYMBOL_RE.test(s));
    const rejected = rawSyms.filter((s) => !SYMBOL_RE.test(s));
    if (rejected.length) {
      setError(`Invalid ticker(s): ${rejected.join(', ')}`);
      return;
    }
    if (!syms.length) { setError('Enter at least one ticker'); return; }

    const config = {
      timeframe: autoTimeframe,
      useBracketOrders: autoUseBracket,
    };

    // Bounds: risk up to $100k/trade; times 0–390 (one trading session in min);
    // ADX 0–100; trades/day up to 500; trailing 0–50%.
    const risk = clamp(autoRiskPerTrade, { min: 0, max: 100000 });
    if (risk != null && risk > 0) config.riskPerTrade = risk;
    const firstMin = clamp(autoAvoidFirstMin, { min: 0, max: 390 });
    if (firstMin != null && firstMin > 0) config.avoidFirstMin = Math.floor(firstMin);
    const lastMin = clamp(autoAvoidLastMin, { min: 0, max: 390 });
    if (lastMin != null && lastMin > 0) config.avoidLastMin = Math.floor(lastMin);
    if (autoFlattenOnClose) config.flattenOnClose = true;
    const maxTrades = clamp(autoMaxDailyTrades, { min: 0, max: 500 });
    if (maxTrades != null && maxTrades > 0) config.maxDailyTrades = Math.floor(maxTrades);
    if (autoUseTrailing) {
      config.useTrailingStop = true;
      const tp = clamp(autoTrailingPct, { min: 0, max: 50 });
      if (tp != null && tp > 0) config.trailingStopPct = tp / 100;
    }
    const mAdx = clamp(autoMinAdx, { min: 0, max: 100 });
    if (mAdx != null && mAdx > 0) config.minAdx = mAdx;

    // Trading window (0..390 = one US session in min).
    const tStart = clamp(autoTradeStartMin, { min: 0, max: 390 });
    const tEnd   = clamp(autoTradeEndMin,   { min: 0, max: 390 });
    if (tStart != null) config.tradeStartMin = Math.floor(tStart);
    if (tEnd != null)   config.tradeEndMin   = Math.floor(tEnd);

    // Blackout flags
    if (autoSkipFomc) config.skipFomc = true;
    if (autoSkipCpi)  config.skipCpi  = true;
    if (autoSkipNfp)  config.skipNfp  = true;
    if (autoSkipEarnings) config.skipEarnings = true;

    // Skip dates — strict YYYY-MM-DD only; silently drop junk.
    const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
    const skipDates = autoSkipDates.split(',').map((d) => d.trim()).filter((d) => DATE_RE.test(d));
    if (skipDates.length) config.skipDates = skipDates;

    // Per-symbol overrides — parse JSON, fail gracefully with a visible error.
    if (autoPerSymbolText.trim()) {
      try {
        const parsed = JSON.parse(autoPerSymbolText);
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
          config.perSymbol = parsed;
        } else {
          setError('Per-symbol overrides must be a JSON object keyed by symbol');
          return;
        }
      } catch (e) {
        setError(`Per-symbol JSON invalid: ${e.message}`);
        return;
      }
    }

    // Live mode: only forward the ack when the user explicitly ticks the box,
    // and only after status confirms the server is in live mode.
    if (autoStatus?.mode === 'live') {
      if (!autoLiveAck) {
        setError('LIVE trading is enabled on the server. Tick "I acknowledge LIVE trading" to proceed.');
        return;
      }
      config.modeAcknowledged = 'live';
    } else {
      config.modeAcknowledged = 'paper';
    }

    try {
      await startAutoTrader(autoStrategy, syms, config);
      refreshAutoStatus();
    } catch (err) {
      setError(err.message);
    }
  };

  const handleStopAuto = async () => {
    try {
      await stopAutoTrader();
      refreshAutoStatus();
    } catch (err) {
      setError(err.message);
    }
  };

  return (
    <div className="page-content">
      <div className="page-header">
        <h1><FiZap size={24} /> Strategy Lab</h1>
        <p>Select strategies, backtest on real market data, find the best one, and auto-trade it</p>
      </div>

      {error && <div className="error-msg">{error}</div>}

      {/* ── Strategy Selector ── */}
      <div className="strategy-selector">
        <div className="strategy-selector-header">
          <h3>Select Strategies ({selectedStrategies.length}/{strategies.length})</h3>
          <div className="strategy-selector-actions">
            <button className="btn-link" onClick={selectAll}>Select All</button>
            <button className="btn-link" onClick={selectNone}>Clear All</button>
          </div>
        </div>
        <div className="strategy-checkbox-grid">
          {strategies.map(s => (
            <label key={s.key} className={`strategy-checkbox ${selectedStrategies.includes(s.key) ? 'checked' : ''}`}>
              <input
                type="checkbox"
                checked={selectedStrategies.includes(s.key)}
                onChange={() => toggleStrategy(s.key)}
              />
              <span className="checkbox-icon">
                {selectedStrategies.includes(s.key) ? <FiCheckSquare size={16} /> : <span className="checkbox-empty" />}
              </span>
              <span className="checkbox-label">
                <span className="checkbox-name">
                  {s.name}
                  {s.intraday && <span className="strategy-intraday-tag"> INTRADAY</span>}
                </span>
                <span className="checkbox-desc">{s.description}</span>
              </span>
            </label>
          ))}
        </div>
      </div>

      {/* PDT warning — US rule: <$25K equity = max 3 day trades per 5 trading days. */}
      {account && parseFloat(account.equity) < 25000 && (
        <div className="pdt-warning" style={{
          background: 'rgba(234, 179, 8, 0.1)',
          border: '1px solid rgba(234, 179, 8, 0.4)',
          padding: '10px 14px',
          borderRadius: 6,
          marginBottom: 12,
          fontSize: 13,
          color: '#fbbf24',
          display: 'flex',
          alignItems: 'center',
          gap: 8,
        }}>
          <FiAlertTriangle />
          <span>
            PDT rule: account equity <strong>${parseFloat(account.equity).toLocaleString()}</strong> is below $25,000.
            Under FINRA PDT you can only open-and-close the same symbol up to 3 times in any rolling 5-trading-day window.
            {account.daytrade_count != null && (
              <> Current day-trade count: <strong>{account.daytrade_count}</strong>.</>
            )}
          </span>
        </div>
      )}

      {/* Cost & validation knobs — apply to all backtest tabs below. */}
      {tab !== 'auto' && (
        <div className="lab-controls" style={{ marginBottom: 12 }}>
          <div className="lab-field">
            <label>Slippage (bps)<DocsHint slug="configuration" label="Slippage" /></label>
            <input type="number" min="0" step="1" placeholder="e.g. 5"
              value={costSlippageBps} onChange={e => setCostSlippageBps(e.target.value)} />
          </div>
          <div className="lab-field">
            <label>Commission $ / side<DocsHint slug="configuration" label="Commission" /></label>
            <input type="number" min="0" step="0.01" placeholder="e.g. 0.5"
              value={costCommission} onChange={e => setCostCommission(e.target.value)} />
          </div>
          <div className="lab-field">
            <label>OOS ratio (0-0.5)<DocsHint slug="backtesting" label="Out-of-sample ratio" /></label>
            <input type="number" min="0" max="0.5" step="0.05" placeholder="e.g. 0.3"
              value={costOosRatio} onChange={e => setCostOosRatio(e.target.value)} />
          </div>
          <div className="lab-field">
            <label>Min ADX<DocsHint slug="strategy-customization" label="ADX regime filter" /></label>
            <input type="number" min="0" max="100" step="1" placeholder="e.g. 25"
              value={costMinAdx} onChange={e => setCostMinAdx(e.target.value)} />
          </div>
        </div>
      )}

      <div className="lab-tabs">
        <button className={`lab-tab ${tab === 'combo' ? 'active' : ''}`} onClick={() => setTab('combo')}>
          <FiSearch size={16} /> Find Best Combo
        </button>
        <button className={`lab-tab ${tab === 'single' ? 'active' : ''}`} onClick={() => setTab('single')}>
          <FiTarget size={16} /> Individual
        </button>
        <button className={`lab-tab ${tab === 'multi' ? 'active' : ''}`} onClick={() => setTab('multi')}>
          <FiBarChart2 size={16} /> Multi-Symbol
        </button>
        <button className={`lab-tab ${tab === 'auto' ? 'active' : ''}`} onClick={() => setTab('auto')}>
          <FiActivity size={16} /> Auto Trader {autoStatus?.running && <span className="live-dot" />}
        </button>
      </div>

      {/* ── Find Best Combo ── */}
      {tab === 'combo' && (
        <div className="lab-section">
          <div className="combo-intro">
            <p>Tests all combinations of your selected signals (singles, pairs, and triples) to find which combo produces the best results. Signals must agree within a 3-bar window (confluence) to trigger a trade.</p>
          </div>
          <div className="lab-controls">
            <div className="lab-field">
              <label>Symbol</label>
              <input type="text" value={symbol} onChange={e => setSymbol(e.target.value)} placeholder="TSLA" />
            </div>
            <div className="lab-field">
              <label>Period</label>
              <select value={days} onChange={e => setDays(Number(e.target.value))}>
                {DAYS_OPTIONS.map(d => <option key={d} value={d}>{d} days</option>)}
              </select>
            </div>
            <div className="lab-field">
              <label>Timeframe</label>
              <select value={backtestTimeframe} onChange={e => setBacktestTimeframe(e.target.value)}>
                <option value="1Day">Daily</option>
                <option value="4H">4 Hour</option>
                <option value="1H">1 Hour</option>
                <option value="15Min">15 Min</option>
                <option value="5Min">5 Min</option>
                <option value="1Min">1 Min</option>
              </select>
            </div>
            <button
              className="btn btn-primary"
              onClick={runComboBacktest}
              disabled={comboLoading || !selectedStrategies.length}
              title={
                comboLoading
                  ? 'Combo search in progress'
                  : !selectedStrategies.length
                    ? 'Select at least one strategy above'
                    : 'Test all combos of the selected signals'
              }
            >
              {comboLoading ? 'Searching...' : `Test ${selectedStrategies.length} Signals — Find Best Combo`}
            </button>
          </div>

          {comboResults && (
            <div className="lab-results">
              {/* Best Overall */}
              {comboResults.best && (
                <div className="combo-best">
                  <h3>Best Strategy Found</h3>
                  <div className="combo-best-card">
                    <div className="combo-best-name">{comboResults.best.comboName}</div>
                    <div className="combo-best-stats">
                      <span className={comboResults.best.totalPnl >= 0 ? 'positive' : 'negative'}>
                        P&L: {comboResults.best.totalPnl >= 0 ? '+' : ''}${comboResults.best.totalPnl.toLocaleString()}
                      </span>
                      <span>Return: {comboResults.best.totalReturn}%</span>
                      <span>Win Rate: {comboResults.best.winRate}%</span>
                      <span>Trades: {comboResults.best.totalTrades}</span>
                      <span>Sharpe: {comboResults.best.sharpe}</span>
                      <span>Score: {comboResults.best.score}</span>
                    </div>
                  </div>
                </div>
              )}

              <p className="combo-summary">Tested {comboResults.totalCombos} combinations from {selectedStrategies.length} signals on {comboResults.symbol} ({comboResults.barsCount} bars)</p>

              {/* Top Overall */}
              <h3>Top 20 Combinations (Ranked by Score)</h3>
              <div className="combo-table">
                <div className="combo-table-header">
                  <span className="combo-rank">#</span>
                  <span className="combo-name-col">Strategy Combination</span>
                  <span className="combo-size">Signals</span>
                  <span className="combo-pnl">P&L</span>
                  <span className="combo-return">Return</span>
                  <span className="combo-trades">Trades</span>
                  <span className="combo-wr">Win%</span>
                  <span className="combo-sharpe">Sharpe</span>
                  <span className="combo-score">Score</span>
                </div>
                {comboResults.topOverall.map((r, i) => (
                  <ComboRow key={i} result={r} rank={i + 1} onExpand={() => {}} />
                ))}
              </div>

              {/* Trade Details for Best */}
              {comboResults.best && comboResults.best.trades.length > 0 && (
                <div className="combo-trades-detail">
                  <h3>Trade History — {comboResults.best.comboName}</h3>
                  <div className="trades-table">
                    <div className="trades-table-header">
                      <span>Entry Date</span>
                      <span>Exit Date</span>
                      <span>Entry $</span>
                      <span>Exit $</span>
                      <span>Shares</span>
                      <span>P&L</span>
                      <span>Reason</span>
                    </div>
                    {comboResults.best.trades.map((t, i) => (
                      <div key={i} className={`trades-table-row ${t.pnl >= 0 ? 'win' : 'loss'}`}>
                        <span>{t.entryTime}</span>
                        <span>{t.exitTime}</span>
                        <span>${t.entryPrice.toFixed(2)}</span>
                        <span>${t.exitPrice.toFixed(2)}</span>
                        <span>{t.shares}</span>
                        <span className={t.pnl >= 0 ? 'positive' : 'negative'}>
                          {t.pnl >= 0 ? '+' : ''}${t.pnl.toFixed(2)}
                        </span>
                        <span>{t.reason}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* ── Single Symbol Backtest ── */}
      {tab === 'single' && (
        <div className="lab-section">
          <div className="lab-controls">
            <div className="lab-field">
              <label>Symbol</label>
              <input type="text" value={symbol} onChange={e => setSymbol(e.target.value)} placeholder="TSLA" />
            </div>
            <div className="lab-field">
              <label>Period</label>
              <select value={days} onChange={e => setDays(Number(e.target.value))}>
                {DAYS_OPTIONS.map(d => <option key={d} value={d}>{d} days</option>)}
              </select>
            </div>
            <div className="lab-field">
              <label>Timeframe</label>
              <select value={backtestTimeframe} onChange={e => setBacktestTimeframe(e.target.value)}>
                <option value="1Day">Daily</option>
                <option value="4H">4 Hour</option>
                <option value="1H">1 Hour</option>
                <option value="15Min">15 Min</option>
                <option value="5Min">5 Min</option>
                <option value="1Min">1 Min</option>
              </select>
            </div>
            <button
              className="btn btn-primary"
              onClick={runBacktest}
              disabled={loading || !selectedStrategies.length}
              title={
                loading
                  ? 'Backtest running…'
                  : !selectedStrategies.length
                    ? 'Select at least one strategy above'
                    : 'Run each selected strategy against this symbol'
              }
            >
              {loading ? 'Running...' : `Backtest ${selectedStrategies.length} Strategies`}
            </button>
          </div>

          {results && (
            <div className="lab-results">
              <h3 style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
                Results for {results.symbol} ({results.barsCount} bars, {results.days} days)
                {hvInfo && hvInfo.hvRank != null && (
                  <span style={{
                    fontSize: 12, fontWeight: 400,
                    padding: '2px 10px', borderRadius: 4,
                    background: hvInfo.hvRank >= 80 ? 'rgba(248, 113, 113, 0.2)'
                              : hvInfo.hvRank <= 20 ? 'rgba(52, 211, 153, 0.2)'
                              : 'rgba(148, 163, 184, 0.15)',
                    color:      hvInfo.hvRank >= 80 ? '#fecaca'
                              : hvInfo.hvRank <= 20 ? '#a7f3d0'
                              : '#cbd5e1',
                  }} title={hvInfo.interpretation}>
                    HV rank: {hvInfo.hvRank}
                  </span>
                )}
              </h3>
              {results.strategies?.[0]?.equityCurve?.length > 0 && (
                <div className="equity-panel" style={{ marginBottom: 16 }}>
                  <EquityCurveChart
                    data={results.strategies[0].equityCurve}
                    title={`Equity Curve — ${results.strategies[0].strategy}`}
                    height={220}
                  />
                  <DrawdownChart
                    data={results.strategies[0].equityCurve}
                    title={`Drawdown — peak ${results.strategies[0].maxDrawdown}%`}
                    height={140}
                  />
                  {results.strategies[0].oosReport && (
                    <div style={{ fontSize: 12, color: '#94a3b8', marginTop: 6 }}>
                      OOS validation — In-sample: {results.strategies[0].oosReport.inSample.trades} trades,
                      {' '}${results.strategies[0].oosReport.inSample.totalPnl}
                      {' '}({results.strategies[0].oosReport.inSample.winRate}% WR)
                      {' '}vs Out-of-sample: {results.strategies[0].oosReport.outSample.trades} trades,
                      {' '}${results.strategies[0].oosReport.outSample.totalPnl}
                      {' '}({results.strategies[0].oosReport.outSample.winRate}% WR)
                    </div>
                  )}
                </div>
              )}
              <div className="strategy-grid">
                {results.strategies.map((r, i) => (
                  <StrategyCard key={r.strategyKey} result={r} rank={i + 1} />
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── Multi-Symbol Backtest ── */}
      {tab === 'multi' && (
        <div className="lab-section">
          <div className="lab-controls">
            <div className="lab-field">
              <label>AI Theme basket</label>
              <select value={multiThemeSlug} onChange={e => setMultiThemeSlug(e.target.value)}>
                <option value="">— Default universe —</option>
                {themes.map(t => (
                  <option key={t.slug} value={t.slug}>{t.name}</option>
                ))}
              </select>
            </div>
            <div className="lab-field">
              <label>Symbols ({multiSymbols.length})</label>
              <span className="lab-symbols-list">{multiSymbols.join(', ')}</span>
            </div>
            <div className="lab-field">
              <label>Period</label>
              <select value={days} onChange={e => setDays(Number(e.target.value))}>
                {DAYS_OPTIONS.map(d => <option key={d} value={d}>{d} days</option>)}
              </select>
            </div>
            <div className="lab-field">
              <label>Timeframe</label>
              <select value={backtestTimeframe} onChange={e => setBacktestTimeframe(e.target.value)}>
                <option value="1Day">Daily</option>
                <option value="4H">4 Hour</option>
                <option value="1H">1 Hour</option>
                <option value="15Min">15 Min</option>
                <option value="5Min">5 Min</option>
                <option value="1Min">1 Min</option>
              </select>
            </div>
            <button
              className="btn btn-primary"
              onClick={runMultiBacktest}
              disabled={multiLoading || !selectedStrategies.length}
              title={
                multiLoading
                  ? 'Multi-symbol backtest running…'
                  : !selectedStrategies.length
                    ? 'Select at least one strategy above'
                    : 'Test each selected strategy against every default symbol'
              }
            >
              {multiLoading ? 'Running all...' : `Backtest ${selectedStrategies.length} × ${multiSymbols.length} Symbols`}
            </button>
          </div>

          {multiResults && (
            <div className="lab-results">
              <h3>Strategy Ranking Across {multiResults.symbols.length} Symbols</h3>
              <div className="ranking-table">
                <div className="ranking-header">
                  <span className="rank-col">#</span>
                  <span className="rank-strategy">Strategy</span>
                  <span className="rank-pnl">Total P&L</span>
                  <span className="rank-trades">Trades</span>
                  <span className="rank-winrate">Win Rate</span>
                  <span className="rank-symbols">Symbols</span>
                </div>
                {multiResults.ranking.map((r, i) => (
                  <div key={r.strategyKey} className={`ranking-row ${i === 0 ? 'best' : ''}`}>
                    <span className="rank-col">{i + 1}</span>
                    <span className="rank-strategy">{r.name}</span>
                    <span className={`rank-pnl ${r.totalPnl >= 0 ? 'positive' : 'negative'}`}>
                      ${r.totalPnl.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </span>
                    <span className="rank-trades">{r.totalTrades}</span>
                    <span className="rank-winrate">{r.winRate}%</span>
                    <span className="rank-symbols">{r.symbols}</span>
                  </div>
                ))}
              </div>

              {multiResults.ranking[0] && (
                <div className="best-strategy-detail">
                  <h3>
                    Best Strategy: {multiResults.ranking[0].name}
                    <span className="best-badge">#{1}</span>
                  </h3>
                  <div className="strategy-grid">
                    {Object.entries(multiResults.details).map(([sym, results]) => {
                      const r = results.find(r => r.strategyKey === multiResults.ranking[0].strategyKey);
                      if (!r || r.error) return null;
                      return <StrategyCard key={sym} result={r} symbol={sym} />;
                    })}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* ── Auto Trader ── */}
      {tab === 'auto' && (
        <div className="lab-section">
          {/* Mode banner — warn loudly if the server is pointed at live brokerage. */}
          {autoStatus?.mode === 'live' ? (
            <div style={{
              margin: '8px 0 16px',
              padding: '10px 14px',
              border: '1px solid #f87171',
              background: 'rgba(248, 113, 113, 0.1)',
              color: '#fecaca',
              borderRadius: 8,
              fontWeight: 600,
              display: 'flex',
              alignItems: 'center',
              gap: 8,
            }}>
              <FiAlertTriangle /> LIVE TRADING MODE — orders will be sent to the real brokerage.
            </div>
          ) : autoStatus?.mode === 'paper' ? (
            <div style={{
              margin: '8px 0 16px',
              padding: '8px 12px',
              border: '1px solid rgba(52, 211, 153, 0.4)',
              background: 'rgba(52, 211, 153, 0.08)',
              color: '#a7f3d0',
              borderRadius: 8,
              fontSize: 13,
            }}>
              Paper trading mode — no real money at risk.
            </div>
          ) : null}
          {autoStatus?.running ? (
            <div className="auto-running">
              <div className="auto-status-header">
                <span className="live-badge"><span className="live-dot" /> RUNNING</span>
                <span>Strategy: <strong>{autoStatus.strategyName}</strong></span>
                <span>Symbols: <strong>{autoStatus.symbols.join(', ')}</strong></span>
                {autoStatus.config?.timeframe && (
                  <span>TF: <strong>{autoStatus.config.timeframe}</strong></span>
                )}
                <span>Since: {new Date(autoStatus.startedAt).toLocaleString()}</span>
                <button className="btn btn-danger" onClick={handleStopAuto}>
                  <FiSquare size={14} /> Stop
                </button>
              </div>

              {/* Live positions — polled every 10s while running. */}
              {/* Lifetime revenue panel — realized + unrealized P&L across every auto trade. */}
              {autoStatus.summary && (
                <div className="auto-revenue" style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))',
                  gap: 8,
                  margin: '12px 0',
                  padding: 12,
                  background: 'rgba(30, 41, 59, 0.5)',
                  border: '1px solid rgba(148, 163, 184, 0.2)',
                  borderRadius: 8,
                }}>
                  {(() => {
                    const s = autoStatus.summary;
                    const fmt = (n) => (n >= 0 ? '+$' : '-$') + Math.abs(n).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
                    const color = (n) => (n >= 0 ? '#34d399' : '#f87171');
                    return (
                      <>
                        <div>
                          <div style={{ fontSize: 11, color: '#94a3b8', textTransform: 'uppercase' }}>Total P&L</div>
                          <div style={{ fontSize: 20, fontWeight: 600, color: color(s.totalPnl) }}>{fmt(s.totalPnl)}</div>
                        </div>
                        <div>
                          <div style={{ fontSize: 11, color: '#94a3b8', textTransform: 'uppercase' }}>Realized</div>
                          <div style={{ fontSize: 16, color: color(s.realizedPnl) }}>{fmt(s.realizedPnl)}</div>
                        </div>
                        <div>
                          <div style={{ fontSize: 11, color: '#94a3b8', textTransform: 'uppercase' }}>Unrealized</div>
                          <div style={{ fontSize: 16, color: color(s.unrealizedPnl) }}>{fmt(s.unrealizedPnl)}</div>
                        </div>
                        <div>
                          <div style={{ fontSize: 11, color: '#94a3b8', textTransform: 'uppercase' }}>Win Rate</div>
                          <div style={{ fontSize: 16 }}>{s.winRate}% <span style={{ color: '#94a3b8', fontSize: 12 }}>({s.wins}/{s.totalTrades})</span></div>
                        </div>
                        <div>
                          <div style={{ fontSize: 11, color: '#94a3b8', textTransform: 'uppercase' }}>Best</div>
                          <div style={{ fontSize: 14 }}>{s.bestTrade ? `${s.bestTrade.symbol} ${fmt(s.bestTrade.pnl)}` : '—'}</div>
                        </div>
                        <div>
                          <div style={{ fontSize: 11, color: '#94a3b8', textTransform: 'uppercase' }}>Worst</div>
                          <div style={{ fontSize: 14 }}>{s.worstTrade ? `${s.worstTrade.symbol} ${fmt(s.worstTrade.pnl)}` : '—'}</div>
                        </div>
                      </>
                    );
                  })()}
                  {autoStatus.summary.perSymbol?.length > 0 && (
                    <div style={{ gridColumn: '1 / -1', marginTop: 6, fontSize: 12, color: '#cbd5e1' }}>
                      Per-symbol: {autoStatus.summary.perSymbol.map((s) =>
                        `${s.symbol} ${(s.pnl >= 0 ? '+' : '') + s.pnl} (${s.trades})`).join(' · ')}
                    </div>
                  )}
                </div>
              )}

              <div className="auto-live-positions">
                <h4>Live Positions ({livePositions.length})</h4>
                {livePositions.length === 0 ? (
                  <p className="muted">No open positions.</p>
                ) : (
                  <div className="live-positions-table">
                    <div className="live-pos-header">
                      <span>Symbol</span>
                      <span>Qty</span>
                      <span>Avg Entry</span>
                      <span>Current</span>
                      <span>Unrealized P&L</span>
                      <span>%</span>
                    </div>
                    {livePositions.map((p) => {
                      const pnl = parseFloat(p.unrealized_pl) || 0;
                      const pct = (parseFloat(p.unrealized_plpc) || 0) * 100;
                      return (
                        <div key={p.symbol} className={`live-pos-row ${pnl >= 0 ? 'win' : 'loss'}`}>
                          <span><strong>{p.symbol}</strong></span>
                          <span>{p.qty}</span>
                          <span>${parseFloat(p.avg_entry_price).toFixed(2)}</span>
                          <span>${parseFloat(p.current_price).toFixed(2)}</span>
                          <span className={pnl >= 0 ? 'positive' : 'negative'}>
                            {pnl >= 0 ? '+' : ''}${pnl.toFixed(2)}
                          </span>
                          <span className={pct >= 0 ? 'positive' : 'negative'}>
                            {pct >= 0 ? '+' : ''}{pct.toFixed(2)}%
                          </span>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              <div className="auto-trades">
                <h4>
                  Auto Trades ({autoStatus.trades.length})
                  {(() => {
                    // Count trades created today for the daily kill-switch indicator.
                    const startOfDay = new Date(); startOfDay.setHours(0, 0, 0, 0);
                    const today = (autoStatus.trades || []).filter(
                      (t) => new Date(t.createdAt || t.time || 0) >= startOfDay,
                    ).length;
                    const cap = autoStatus.config?.maxDailyTrades;
                    return (
                      <span style={{ marginLeft: 10, fontSize: 12, color: '#94a3b8' }}>
                        Today: <strong>{today}</strong>{cap ? ` / ${cap}` : ''}
                      </span>
                    );
                  })()}
                </h4>
                {autoStatus.trades.length === 0 && <p className="muted">No trades yet — waiting for signals...</p>}
                {autoStatus.trades.map((t) => (
                  <AutoTradeRow key={t.id ?? `${t.symbol}-${t.time}`} trade={t} onMutated={refreshAutoStatus} />
                ))}
              </div>

              {Array.isArray(autoStatus.log) && autoStatus.log.length > 0 && (
                <div className="auto-log">
                  <h4>Log</h4>
                  {autoStatus.log.map((l, i) => (
                    <div key={i} className="log-entry">
                      <span className="log-time">{new Date(l.time).toLocaleTimeString()}</span>
                      <span>{l.message}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ) : (
            <div className="auto-setup">
              <h3>Configure Auto Trader</h3>
              <p>Select a strategy and symbols. The auto trader will monitor signals and place paper trades automatically.</p>

              <div className="lab-controls">
                <div className="lab-field">
                  <label>Strategy</label>
                  <select value={autoStrategy} onChange={e => setAutoStrategy(e.target.value)}>
                    <option value="">Select strategy...</option>
                    {strategies.filter(s => selectedStrategies.includes(s.key)).map(s => (
                      <option key={s.key} value={s.key}>{s.name}</option>
                    ))}
                  </select>
                </div>
                <div className="lab-field">
                  <label>Symbols (comma-separated)</label>
                  <input type="text" value={autoSymbols} onChange={e => setAutoSymbols(e.target.value)} />
                </div>
                <div className="lab-field">
                  <label>Timeframe<DocsHint slug="bot-basics" label="Bot basics — timeframes" /></label>
                  <select value={autoTimeframe} onChange={e => setAutoTimeframe(e.target.value)}>
                    <option value="1Min">1 min (day trading)</option>
                    <option value="5Min">5 min (day trading)</option>
                    <option value="15Min">15 min (day trading)</option>
                    <option value="1H">1 hour (swing)</option>
                    <option value="4H">4 hour (swing)</option>
                    <option value="1Day">Daily (swing)</option>
                  </select>
                </div>
                <div className="lab-field">
                  <label>Risk per trade $ (optional)</label>
                  <input
                    type="number"
                    min="0"
                    step="10"
                    placeholder="e.g. 100"
                    value={autoRiskPerTrade}
                    onChange={e => setAutoRiskPerTrade(e.target.value)}
                  />
                </div>
                <div className="lab-field">
                  <label>
                    <input
                      type="checkbox"
                      checked={autoUseBracket}
                      onChange={e => setAutoUseBracket(e.target.checked)}
                    />
                    {' '}Bracket orders (server-side stop + target)
                  </label>
                </div>
                <div className="lab-field">
                  <label>Avoid first N min after open</label>
                  <input type="number" min="0" step="1" placeholder="e.g. 15"
                    value={autoAvoidFirstMin} onChange={e => setAutoAvoidFirstMin(e.target.value)} />
                </div>
                <div className="lab-field">
                  <label>Avoid last N min before close</label>
                  <input type="number" min="0" step="1" placeholder="e.g. 10"
                    value={autoAvoidLastMin} onChange={e => setAutoAvoidLastMin(e.target.value)} />
                </div>
                <div className="lab-field">
                  <label>
                    <input type="checkbox" checked={autoFlattenOnClose}
                      onChange={e => setAutoFlattenOnClose(e.target.checked)} />
                    {' '}Flatten all positions near market close (EOD)
                  </label>
                </div>
                <div className="lab-field">
                  <label>Max daily trades (kill switch)</label>
                  <input type="number" min="0" step="1" placeholder="e.g. 20"
                    value={autoMaxDailyTrades} onChange={e => setAutoMaxDailyTrades(e.target.value)} />
                </div>
                <div className="lab-field">
                  <label>
                    <input type="checkbox" checked={autoUseTrailing}
                      onChange={e => setAutoUseTrailing(e.target.checked)} />
                    {' '}Trailing stop (%)
                    <DocsHint slug="stoploss" label="Trailing stoploss" />
                  </label>
                  {autoUseTrailing && (
                    <input type="number" min="0.1" max="50" step="0.1"
                      value={autoTrailingPct} onChange={e => setAutoTrailingPct(e.target.value)} />
                  )}
                </div>
                <div className="lab-field">
                  <label>Min ADX (regime gate)<DocsHint slug="strategy-customization" label="Strategy filters" /></label>
                  <input type="number" min="0" max="100" step="1" placeholder="e.g. 25"
                    value={autoMinAdx} onChange={e => setAutoMinAdx(e.target.value)} />
                </div>
                <div className="lab-field">
                  <label>Trade window — start (min after open)</label>
                  <input type="number" min="0" max="390" step="1" placeholder="e.g. 30"
                    value={autoTradeStartMin} onChange={e => setAutoTradeStartMin(e.target.value)} />
                </div>
                <div className="lab-field">
                  <label>Trade window — end (min after open, 390 = close)</label>
                  <input type="number" min="0" max="390" step="1" placeholder="e.g. 360"
                    value={autoTradeEndMin} onChange={e => setAutoTradeEndMin(e.target.value)} />
                </div>
                <div className="lab-field">
                  <label>Macro-event blackouts<DocsHint slug="strategy-advanced" label="Advanced strategy — event gating" /></label>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
                    <label><input type="checkbox" checked={autoSkipFomc}
                      onChange={e => setAutoSkipFomc(e.target.checked)} /> FOMC</label>
                    <label><input type="checkbox" checked={autoSkipCpi}
                      onChange={e => setAutoSkipCpi(e.target.checked)} /> CPI</label>
                    <label><input type="checkbox" checked={autoSkipNfp}
                      onChange={e => setAutoSkipNfp(e.target.checked)} /> NFP</label>
                    <label><input type="checkbox" checked={autoSkipEarnings}
                      onChange={e => setAutoSkipEarnings(e.target.checked)} /> Earnings (requires per-symbol calendar entries)</label>
                  </div>
                </div>
                <div className="lab-field">
                  <label>Skip dates (comma-separated, YYYY-MM-DD)</label>
                  <input type="text" placeholder="2026-05-01, 2026-05-02"
                    value={autoSkipDates} onChange={e => setAutoSkipDates(e.target.value)} />
                </div>
                <div className="lab-field" style={{ gridColumn: '1 / -1' }}>
                  <label>
                    Per-symbol overrides (JSON, keyed by symbol)
                    <DocsHint slug="configuration" label="Configuration — pair overrides" />
                    <span style={{ color: '#94a3b8', fontWeight: 400, fontSize: 12, marginLeft: 8 }}>
                      e.g. {'{ "TSLA": { "stopLossPct": 0.03 } }'}
                    </span>
                  </label>
                  <textarea rows={3} style={{ fontFamily: 'ui-monospace, monospace', fontSize: 12 }}
                    placeholder='{ "TSLA": { "stopLossPct": 0.03 } }'
                    value={autoPerSymbolText}
                    onChange={e => setAutoPerSymbolText(e.target.value)} />
                </div>
                {autoStatus?.mode === 'live' && (
                  <div className="lab-field" style={{ gridColumn: '1 / -1' }}>
                    <label style={{ color: '#fecaca' }}>
                      <input type="checkbox" checked={autoLiveAck}
                        onChange={e => setAutoLiveAck(e.target.checked)} />
                      {' '}I acknowledge this will place LIVE orders with real money.
                    </label>
                  </div>
                )}
                <button
                  className="btn btn-primary"
                  onClick={handleStartAuto}
                  disabled={!autoStrategy || (autoStatus?.mode === 'live' && !autoLiveAck)}
                  title={
                    !autoStrategy
                      ? 'Pick a strategy above to enable'
                      : (autoStatus?.mode === 'live' && !autoLiveAck)
                        ? 'Confirm the live-trading acknowledgement to enable'
                        : 'Start auto-trader with current config'
                  }
                >
                  <FiPlay size={14} /> Start Auto Trader
                </button>
              </div>

              {multiResults?.ranking?.[0] && (
                <div className="auto-suggestion">
                  <p>Based on backtesting, the best strategy is <strong>{multiResults.ranking[0].name}</strong> with {multiResults.ranking[0].winRate}% win rate.</p>
                  <button className="btn btn-secondary" onClick={() => setAutoStrategy(multiResults.ranking[0].strategyKey)}>
                    Use Best Strategy
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function ComboRow({ result: r, rank }) {
  const [expanded, setExpanded] = useState(false);
  const trades = r.trades || [];
  const totalBought = trades.reduce((sum, t) => sum + t.entryPrice * t.shares, 0);
  const totalSold = trades.reduce((sum, t) => sum + t.exitPrice * t.shares, 0);
  const netRevenue = totalSold - totalBought;

  return (
    <>
      <div className={`combo-table-row ${rank === 1 ? 'best' : ''} ${r.totalPnl >= 0 ? 'profit' : 'loss'}`} onClick={() => setExpanded(!expanded)}>
        <span className="combo-rank">{rank}</span>
        <span className="combo-name-col">{r.comboName}</span>
        <span className="combo-size">{r.comboSize === 1 ? 'Single' : r.comboSize === 2 ? 'Pair' : 'Triple'}</span>
        <span className={`combo-pnl ${r.totalPnl >= 0 ? 'positive' : 'negative'}`}>
          {r.totalPnl >= 0 ? '+' : ''}${r.totalPnl.toLocaleString()}
        </span>
        <span className={`combo-return ${r.totalReturn >= 0 ? 'positive' : 'negative'}`}>{r.totalReturn}%</span>
        <span className="combo-trades">{r.totalTrades}</span>
        <span className={`combo-wr ${r.winRate >= 50 ? 'positive' : 'negative'}`}>{r.winRate}%</span>
        <span className="combo-sharpe">{r.sharpe}</span>
        <span className="combo-score">{r.score}</span>
      </div>
      {expanded && trades.length > 0 && (
        <div className="combo-expanded-trades">
          <div className="combo-revenue-summary">
            <span>Total Bought: <strong>${totalBought.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</strong></span>
            <span>Total Sold: <strong>${totalSold.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</strong></span>
            <span>Net Revenue: <strong className={netRevenue >= 0 ? 'positive' : 'negative'}>{netRevenue >= 0 ? '+' : ''}${netRevenue.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</strong></span>
          </div>
          <div className="trades-table">
            <div className="trades-table-header">
              <span>Entry Date</span>
              <span>Exit Date</span>
              <span>Entry $</span>
              <span>Exit $</span>
              <span>Shares</span>
              <span>Bought $</span>
              <span>Sold $</span>
              <span>P&L</span>
              <span>Reason</span>
            </div>
            {trades.map((t, i) => (
              <div key={i} className={`trades-table-row ${t.pnl >= 0 ? 'win' : 'loss'}`}>
                <span>{t.entryTime}</span>
                <span>{t.exitTime}</span>
                <span>${t.entryPrice.toFixed(2)}</span>
                <span>${t.exitPrice.toFixed(2)}</span>
                <span>{t.shares}</span>
                <span>${(t.entryPrice * t.shares).toFixed(2)}</span>
                <span>${(t.exitPrice * t.shares).toFixed(2)}</span>
                <span className={t.pnl >= 0 ? 'positive' : 'negative'}>
                  {t.pnl >= 0 ? '+' : ''}${t.pnl.toFixed(2)}
                </span>
                <span>{t.reason}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </>
  );
}

function StrategyCard({ result: r, rank, symbol }) {
  const [showTrades, setShowTrades] = useState(false);

  if (r.error) return (
    <div className="strategy-card error">
      <h4>{r.strategy}</h4>
      <p>{r.error}</p>
    </div>
  );

  const isProfit = r.totalPnl >= 0;
  const trades = r.trades || [];

  // Calculate total bought and total sold
  const totalBought = trades.reduce((sum, t) => sum + t.entryPrice * t.shares, 0);
  const totalSold = trades.reduce((sum, t) => sum + t.exitPrice * t.shares, 0);
  const netRevenue = totalSold - totalBought;

  return (
    <div className={`strategy-card ${isProfit ? 'profit' : 'loss'} ${rank === 1 ? 'best' : ''}`}>
      <div className="strategy-card-header">
        {rank && <span className="strategy-rank">#{rank}</span>}
        <h4>{symbol ? `${symbol}` : r.strategy}</h4>
        {isProfit ? <FiTrendingUp className="trend-icon up" /> : <FiTrendingDown className="trend-icon down" />}
      </div>
      <div className="strategy-card-pnl">
        <span className={isProfit ? 'positive' : 'negative'}>
          {isProfit ? '+' : ''}${r.totalPnl.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
        </span>
        <span className={`pnl-pct ${isProfit ? 'positive' : 'negative'}`}>
          ({isProfit ? '+' : ''}{r.totalReturn}%)
        </span>
      </div>

      {/* Revenue Summary */}
      {trades.length > 0 && (
        <div className="strategy-card-revenue">
          <div className="revenue-row">
            <span>Total Bought</span>
            <span className="revenue-val bought">${totalBought.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
          </div>
          <div className="revenue-row">
            <span>Total Sold</span>
            <span className="revenue-val sold">${totalSold.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
          </div>
          <div className="revenue-row total">
            <span>Net Revenue</span>
            <span className={`revenue-val ${netRevenue >= 0 ? 'positive' : 'negative'}`}>
              {netRevenue >= 0 ? '+' : ''}${netRevenue.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </span>
          </div>
        </div>
      )}

      <div className="strategy-card-stats">
        <div className="stat-row">
          <span>Trades</span><span>{r.totalTrades}</span>
        </div>
        <div className="stat-row">
          <span>Win Rate</span><span className={r.winRate >= 50 ? 'positive' : 'negative'}>{r.winRate}%</span>
        </div>
        <div className="stat-row">
          <span>W/L</span><span>{r.wins}/{r.losses}</span>
        </div>
        <div className="stat-row">
          <span>Avg Win</span><span className="positive">${r.avgWin.toFixed(2)}</span>
        </div>
        <div className="stat-row">
          <span>Avg Loss</span><span className="negative">-${r.avgLoss.toFixed(2)}</span>
        </div>
        <div className="stat-row">
          <span>Profit Factor</span><span>{r.profitFactor}</span>
        </div>
        <div className="stat-row">
          <span>Max Drawdown</span><span className="negative">{r.maxDrawdown}%</span>
        </div>
        <div className="stat-row">
          <span>Sharpe Ratio</span><span>{r.sharpe}</span>
        </div>
      </div>

      {trades.length > 0 && (
        <div className="strategy-card-trades">
          <button className="btn-link trade-toggle" onClick={() => setShowTrades(!showTrades)}>
            {showTrades ? 'Hide' : 'Show'} {trades.length} Trade{trades.length !== 1 ? 's' : ''} Details
          </button>
          {showTrades && (
            <div className="card-trades-list">
              {trades.map((t, i) => {
                const boughtTotal = t.entryPrice * t.shares;
                const soldTotal = t.exitPrice * t.shares;
                return (
                  <div key={i} className={`card-trade ${t.pnl >= 0 ? 'win' : 'loss'}`}>
                    <div className="card-trade-entry">
                      <span className="trade-action buy">BUY</span>
                      <span>{t.entryTime}</span>
                      <span className="trade-price">${t.entryPrice.toFixed(2)}</span>
                      <span className="trade-shares">× {t.shares}</span>
                      <span className="trade-total bought">= ${boughtTotal.toFixed(2)}</span>
                    </div>
                    <div className="card-trade-exit">
                      <span className="trade-action sell">SELL</span>
                      <span>{t.exitTime}</span>
                      <span className="trade-price">${t.exitPrice.toFixed(2)}</span>
                      <span className="trade-shares">× {t.shares}</span>
                      <span className="trade-total sold">= ${soldTotal.toFixed(2)}</span>
                    </div>
                    <div className="card-trade-bottom">
                      <span className={`trade-pnl ${t.pnl >= 0 ? 'positive' : 'negative'}`}>
                        P&L: {t.pnl >= 0 ? '+' : ''}${t.pnl.toFixed(2)}
                      </span>
                      <span className="card-trade-reason">{t.reason}</span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * Expandable auto-trade row. Collapsed view matches the original one-liner;
 * when expanded it shows the entryContext indicator snapshot (why the bot
 * entered), a tag editor, and a "Journal this" shortcut.
 */
function AutoTradeRow({ trade: t, onMutated }) {
  const [expanded, setExpanded] = useState(false);
  const [tagInput, setTagInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const tags = Array.isArray(t.tags) ? t.tags : [];
  const ctx = t.entryContext || {};
  const hasCtx = ctx && Object.keys(ctx).length > 0;
  const fmt = (n) => (n == null || Number.isNaN(n)) ? '—' : (+n).toFixed(2);

  const saveTags = async (next) => {
    if (!t.id) return;
    setBusy(true); setErr('');
    try {
      await updateAutoTraderTradeTags(t.id, next);
      onMutated?.();
    } catch (e) { setErr(e.message); }
    setBusy(false);
  };

  const addTag = () => {
    const v = tagInput.trim();
    if (!v || tags.includes(v) || tags.length >= 10) return;
    setTagInput('');
    saveTags([...tags, v]);
  };
  const removeTag = (tag) => saveTags(tags.filter((x) => x !== tag));

  const journal = async () => {
    if (!t.id) return;
    setBusy(true); setErr('');
    try {
      await journalAutoTraderTrade(t.id);
    } catch (e) { setErr(e.message); }
    setBusy(false);
  };

  return (
    <div className={`auto-trade-row ${t.action}`} style={{ flexDirection: 'column', alignItems: 'stretch' }}>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', cursor: 'pointer' }}
           onClick={() => setExpanded((v) => !v)}>
        {expanded ? <FiChevronDown size={14} /> : <FiChevronRight size={14} />}
        <span className="auto-trade-time">{new Date(t.time).toLocaleString()}</span>
        <span className={`auto-trade-action ${t.action}`}>{t.action.toUpperCase()}</span>
        <span className="auto-trade-symbol">{t.symbol}</span>
        <span>{t.qty} shares @ ${t.price.toFixed(2)}</span>
        <span className="auto-trade-reason" style={{ flex: 1 }}>{t.reason}</span>
        {tags.length > 0 && (
          <span style={{ display: 'flex', gap: 4 }}>
            {tags.slice(0, 3).map((tag) => (
              <span key={tag} style={{
                background: 'rgba(99, 102, 241, 0.2)', color: '#c7d2fe',
                padding: '1px 6px', borderRadius: 3, fontSize: 11,
              }}>#{tag}</span>
            ))}
          </span>
        )}
      </div>
      {expanded && (
        <div style={{ padding: '10px 0 4px 22px', borderTop: '1px dashed rgba(148, 163, 184, 0.2)', marginTop: 8 }}>
          {hasCtx ? (
            <div style={{ fontSize: 12, color: '#cbd5e1', marginBottom: 8 }}>
              <strong style={{ color: '#a5b4fc' }}>Why entered</strong>
              <div style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(110px, 1fr))',
                gap: 8, marginTop: 4,
              }}>
                <span>RSI: <strong>{fmt(ctx.rsi)}</strong></span>
                <span>ADX: <strong>{fmt(ctx.adx)}</strong></span>
                <span>SMA20: <strong>{fmt(ctx.sma20)}</strong></span>
                <span>SMA50: <strong>{fmt(ctx.sma50)}</strong></span>
                <span>SMA200: <strong>{fmt(ctx.sma200)}</strong></span>
                <span>Close: <strong>{fmt(ctx.close)}</strong></span>
              </div>
            </div>
          ) : (
            <p className="muted" style={{ fontSize: 12 }}>No indicator snapshot recorded for this trade.</p>
          )}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', margin: '8px 0' }}>
            <strong style={{ fontSize: 12, color: '#a5b4fc' }}>Tags</strong>
            {tags.map((tag) => (
              <span key={tag} style={{
                background: 'rgba(99, 102, 241, 0.2)', color: '#c7d2fe',
                padding: '2px 8px', borderRadius: 3, fontSize: 12,
                display: 'inline-flex', alignItems: 'center', gap: 4,
              }}>
                #{tag}
                <button
                  type="button"
                  onClick={(e) => { e.stopPropagation(); removeTag(tag); }}
                  style={{ background: 'none', border: 'none', color: '#fecaca', cursor: 'pointer', padding: 0 }}
                  disabled={busy}
                >×</button>
              </span>
            ))}
            <input
              type="text"
              placeholder="add tag"
              value={tagInput}
              onClick={(e) => e.stopPropagation()}
              onChange={(e) => setTagInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addTag(); } }}
              disabled={busy || !t.id || tags.length >= 10}
              style={{ padding: '2px 6px', fontSize: 12, width: 120 }}
            />
            <button
              className="btn-link"
              onClick={(e) => { e.stopPropagation(); journal(); }}
              disabled={busy || !t.id}
              title="Copy into TradeJournal"
            >
              <FiBook size={12} /> Journal
            </button>
          </div>
          {err && <div className="error-msg" style={{ fontSize: 12 }}>{err}</div>}
        </div>
      )}
    </div>
  );
}
