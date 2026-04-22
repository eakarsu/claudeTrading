/**
 * Jupyter export helpers — produce CSV + .ipynb artifacts suitable for
 * dropping into a local notebook for deeper analysis.
 *
 * Freqtrade parity: their `freqtrade-jupyter` extras and the `analysis.ipynb`
 * template expect per-trade CSVs with a fixed column layout. We emit roughly
 * the same shape so a user's existing notebooks keep working.
 */

function csvEscape(v) {
  if (v == null) return '';
  const s = String(v);
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function toCsv(rows, columns) {
  const head = columns.join(',');
  const body = rows.map((r) => columns.map((c) => csvEscape(r[c])).join(',')).join('\n');
  return body ? `${head}\n${body}\n` : `${head}\n`;
}

/**
 * Canonical trade CSV — matches freqtrade's trades_dataframe shape closely.
 */
export function tradesCsv(trades) {
  const rows = (trades || []).map((t) => ({
    pair:         t.symbol || t.pair || '',
    open_date:    t.entryTime || t.open_date || t.entryDate || '',
    close_date:   t.exitTime  || t.close_date || t.exitDate  || '',
    open_rate:    t.entry ?? t.entryPrice ?? t.open_rate ?? '',
    close_rate:   t.exit  ?? t.exitPrice  ?? t.close_rate ?? '',
    profit_pct:   t.pnlPct ?? t.profitPct ?? (t.pnl != null && t.entryPrice != null ? (t.pnl / t.entryPrice) * 100 : ''),
    profit_abs:   t.pnl ?? t.profit_abs ?? '',
    enter_tag:    t.enterTag || t.strategy || '',
    exit_reason:  t.exitReason || t.reason || '',
    leverage:     t.leverage ?? 1,
  }));
  return toCsv(rows, [
    'pair','open_date','close_date','open_rate','close_rate',
    'profit_pct','profit_abs','enter_tag','exit_reason','leverage',
  ]);
}

/**
 * Equity curve as CSV — one row per bar with cumulative equity.
 */
export function equityCsv(equityCurve) {
  const rows = (equityCurve || []).map((p, i) => ({
    idx: i,
    time: p.time || p.t || '',
    equity: p.equity ?? p.value ?? p.v ?? '',
  }));
  return toCsv(rows, ['idx', 'time', 'equity']);
}

/**
 * Bars (OHLCV) as CSV — for loading directly into a pandas DataFrame.
 */
export function barsCsv(bars) {
  return toCsv(bars || [], ['time', 'open', 'high', 'low', 'close', 'volume']);
}

/**
 * Produce an .ipynb skeleton that loads the trades + equity CSVs via pandas
 * and renders the standard analysis cells (profit distribution, equity curve,
 * per-tag breakdown). Users download the notebook, drop the CSVs next to it,
 * and run.
 */
export function analysisNotebook({ name = 'backtest' } = {}) {
  const cells = [
    mdCell([
      `# ${name} — post-run analysis\n`,
      '\n',
      'Load the trades + equity CSVs exported from the web UI and reproduce the dashboard\n',
      'figures in a local notebook.\n',
    ]),
    codeCell([
      'import pandas as pd\n',
      'import matplotlib.pyplot as plt\n',
      '\n',
      "trades = pd.read_csv('trades.csv', parse_dates=['open_date', 'close_date'])\n",
      "equity = pd.read_csv('equity.csv', parse_dates=['time'])\n",
      'trades.head()\n',
    ]),
    mdCell(['## Profit distribution\n']),
    codeCell([
      "trades['profit_pct'].hist(bins=40)\n",
      "plt.title('Per-trade profit %')\n",
      "plt.xlabel('profit %'); plt.ylabel('count')\n",
      'plt.show()\n',
    ]),
    mdCell(['## Equity curve\n']),
    codeCell([
      "equity.plot(x='time', y='equity', figsize=(10, 4))\n",
      "plt.title('Equity')\n",
      'plt.show()\n',
    ]),
    mdCell(['## Breakdown by enter_tag / exit_reason\n']),
    codeCell([
      "by_enter = trades.groupby('enter_tag')['profit_pct'].agg(['count', 'mean', 'sum'])\n",
      "by_exit  = trades.groupby('exit_reason')['profit_pct'].agg(['count', 'mean', 'sum'])\n",
      'print(by_enter)\n',
      'print()\n',
      'print(by_exit)\n',
    ]),
  ];

  return {
    nbformat: 4,
    nbformat_minor: 5,
    metadata: {
      kernelspec: { name: 'python3', display_name: 'Python 3', language: 'python' },
      language_info: { name: 'python' },
    },
    cells,
  };
}

function codeCell(source) {
  return { cell_type: 'code', metadata: {}, execution_count: null, outputs: [], source };
}
function mdCell(source) {
  return { cell_type: 'markdown', metadata: {}, source };
}
