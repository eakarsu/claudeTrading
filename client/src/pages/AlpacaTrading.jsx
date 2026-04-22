import React, { useState, useEffect } from 'react';
import { FiDollarSign, FiTrendingUp, FiTrendingDown, FiRefreshCw, FiXCircle, FiClock } from 'react-icons/fi';
import * as api from '../api';

export default function AlpacaTrading() {
  const [account, setAccount] = useState(null);
  const [positions, setPositions] = useState([]);
  const [orders, setOrders] = useState([]);
  const [clock, setClock] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);

  // Order form
  const [symbol, setSymbol] = useState('');
  const [qty, setQty] = useState('1');
  const [side, setSide] = useState('buy');
  const [orderType, setOrderType] = useState('market');
  const [limitPrice, setLimitPrice] = useState('');
  const [orderLoading, setOrderLoading] = useState(false);
  const [orderResult, setOrderResult] = useState(null);

  const loadAll = async () => {
    setLoading(true);
    setError(null);
    try {
      const [acc, pos, ord, clk] = await Promise.all([
        api.alpacaAccount(),
        api.alpacaPositions(),
        api.alpacaOrders('all'),
        api.alpacaClock(),
      ]);
      setAccount(acc);
      setPositions(pos);
      setOrders(Array.isArray(ord) ? ord.slice(0, 20) : []);
      setClock(clk);
    } catch (err) {
      setError(err.message);
    }
    setLoading(false);
  };

  useEffect(() => { loadAll(); }, []);

  // Close a single position at market. Alpaca liquidates the full qty.
  //
  // Action errors must NOT set the top-level `error` state — doing so hides
  // the whole page behind a "check your API keys" placeholder, which is
  // misleading (the account is clearly working; one action failed) and
  // worse, locks the user out of the cancel/refresh UI they need to
  // recover. Use alert() to surface the error without nuking the page.
  //
  // If the plain close fails with "insufficient qty available" it means a
  // pending order (typically a bracket stop auto-placed on entry) is
  // reserving the qty. We prompt once and retry via the `close-safely`
  // endpoint which cancels pending orders for the symbol first. This saves
  // the user from having to hunt for the offending order in Recent Orders.
  // Close returns the CLOSE ORDER (typically market TIF=day), not a
  // realized fill. If the market is closed when the user clicks Close,
  // Alpaca parks the order as `accepted` / `new` and it only executes
  // at the next open. Surface that state explicitly so the position
  // still appearing in the table reads as "queued" rather than "silently
  // failed".
  const describeClose = (sym, closeOrder) => {
    const status = closeOrder?.status || 'submitted';
    const parked = !clock?.is_open && /accepted|new|pending/i.test(status);
    if (parked) {
      return `${sym} close queued (status: ${status}). Market is closed — Alpaca will execute the order at the next open.`;
    }
    return `${sym} close submitted (status: ${status}). Refresh in a few seconds to see the fill.`;
  };

  const handleClosePosition = async (sym) => {
    if (!window.confirm(`Close entire ${sym} position at market?`)) return;
    try {
      const closeOrder = await api.alpacaClosePosition(sym);
      await loadAll();
      alert(describeClose(sym, closeOrder));
    } catch (err) {
      if (/insufficient qty available/i.test(err.message)) {
        if (window.confirm(
          `${sym} close blocked by a pending order that reserved the qty.\n\n` +
          `Cancel pending ${sym} orders and retry close?`,
        )) {
          try {
            const r = await api.alpacaCloseSafely(sym);
            await loadAll();
            alert(
              `Cancelled ${r.cancelled?.length || 0} pending ${sym} order(s).\n\n` +
              describeClose(sym, r.closeResult),
            );
          } catch (retryErr) {
            alert(`Force close ${sym} failed: ${retryErr.message}`);
          }
          return;
        }
      }
      alert(`Close ${sym} failed: ${err.message}`);
    }
  };

  // Explicit force-close for power users: skips the "try plain close first"
  // path. Bound to the Force button next to each Close button.
  const handleForceClose = async (sym) => {
    if (!window.confirm(
      `Force close ${sym}?\n\nThis cancels every open ${sym} order first, then closes the position.` +
      (clock?.is_open ? '' : '\n\nNote: market is CLOSED — the close order will be parked and execute at the next open.'),
    )) return;
    try {
      const r = await api.alpacaCloseSafely(sym);
      await loadAll();
      alert(
        `Cancelled ${r.cancelled?.length || 0} pending ${sym} order(s).\n\n` +
        describeClose(sym, r.closeResult),
      );
    } catch (err) {
      alert(`Force close ${sym} failed: ${err.message}`);
    }
  };
  const handleFlattenAll = async () => {
    if (!positions.length) return;
    if (!window.confirm(`Flatten ALL ${positions.length} positions and cancel open orders?`)) return;
    try {
      await api.alpacaCloseAllPositions();
      await loadAll();
    } catch (err) { alert(`Flatten all failed: ${err.message}`); }
  };

  const handleOrder = async (e) => {
    e.preventDefault();
    if (!symbol || !qty) return;
    setOrderLoading(true);
    setOrderResult(null);
    try {
      const result = await api.alpacaPlaceOrder({
        symbol: symbol.toUpperCase(),
        qty,
        side,
        type: orderType,
        time_in_force: 'day',
        limit_price: orderType === 'limit' ? limitPrice : undefined,
      });
      setOrderResult({ success: true, data: result });
      setSymbol('');
      setQty('1');
      // Reset side back to Buy after a successful order. Leaving it on the
      // last-used value caused "insufficient qty" errors when a user who
      // placed a Sell earlier then placed what they thought was a Buy.
      setSide('buy');
      setTimeout(loadAll, 1000);
    } catch (err) {
      // Include the side we actually submitted in the error surface so the
      // user sees `Error (SELL): ...` when they thought they were buying.
      setOrderResult({ success: false, error: err.message, side });
    }
    setOrderLoading(false);
  };

  const handleCancel = async (orderId) => {
    try {
      await api.alpacaCancelOrder(orderId);
      loadAll();
    } catch (err) {
      alert(err.message);
    }
  };

  if (error) {
    // Only show the "check your API keys" hint when the error actually
    // looks key-related. Showing it unconditionally (e.g. after an order
    // was rejected for insufficient qty) is actively misleading — the
    // user wastes time re-checking .env when the keys were never the
    // problem.
    const looksLikeKeyIssue = /api key|not configured|401|403|unauthorized/i.test(error);
    return (
      <div className="feature-page">
        <div className="page-header">
          <h1>Alpaca Paper Trading</h1>
          <div className="page-actions">
            <button className="btn btn-secondary" onClick={loadAll}>
              <FiRefreshCw size={16} /> Retry
            </button>
          </div>
        </div>
        <div className="alpaca-error">
          <p>{error}</p>
          {looksLikeKeyIssue && (
            <p style={{ fontSize: 13, color: '#9ca3af', marginTop: 8 }}>
              Make sure your Alpaca API keys are set in the .env file.
            </p>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="feature-page">
      <div className="page-header">
        <h1>Alpaca Paper Trading</h1>
        <div className="page-actions">
          <button className="btn btn-secondary" onClick={loadAll} disabled={loading}>
            <FiRefreshCw size={16} /> Refresh
          </button>
        </div>
      </div>

      {loading && !account ? (
        <div className="loading-state">Connecting to Alpaca...</div>
      ) : (
        <>
          {/* Account + Clock Row */}
          <div className="alpaca-stats-row">
            {account && (
              <>
                <div className="alpaca-stat">
                  <span className="stat-label">Equity</span>
                  <span className="stat-value">${Number(account.equity).toLocaleString(undefined, { minimumFractionDigits: 2 })}</span>
                </div>
                <div className="alpaca-stat">
                  <span className="stat-label">Cash</span>
                  <span className="stat-value">${Number(account.cash).toLocaleString(undefined, { minimumFractionDigits: 2 })}</span>
                </div>
                <div className="alpaca-stat">
                  <span className="stat-label">Buying Power</span>
                  <span className="stat-value">${Number(account.buying_power).toLocaleString(undefined, { minimumFractionDigits: 2 })}</span>
                </div>
                <div className="alpaca-stat">
                  <span className="stat-label">Today P&L</span>
                  <span className="stat-value" style={{ color: Number(account.equity) - Number(account.last_equity) >= 0 ? '#10b981' : '#ef4444' }}>
                    ${(Number(account.equity) - Number(account.last_equity)).toFixed(2)}
                  </span>
                </div>
              </>
            )}
            {clock && (
              <div className="alpaca-stat">
                <span className="stat-label"><FiClock size={12} /> Market</span>
                <span className={`stat-badge ${clock.is_open ? 'badge-green' : 'badge-red'}`}>
                  {clock.is_open ? 'OPEN' : 'CLOSED'}
                </span>
              </div>
            )}
          </div>

          {/* Order Form */}
          <div className="alpaca-order-form">
            <h3>Place Order</h3>
            <form onSubmit={handleOrder} className="order-form-grid">
              <div className="form-field">
                <label>Symbol</label>
                <input value={symbol} onChange={(e) => setSymbol(e.target.value.toUpperCase())} placeholder="AAPL" required />
              </div>
              <div className="form-field">
                <label>Qty</label>
                <input type="number" value={qty} onChange={(e) => setQty(e.target.value)} min="1" required />
              </div>
              <div className="form-field">
                <label>Side</label>
                <select value={side} onChange={(e) => setSide(e.target.value)}>
                  <option value="buy">Buy</option>
                  <option value="sell">Sell</option>
                </select>
              </div>
              <div className="form-field">
                <label>Type</label>
                <select value={orderType} onChange={(e) => setOrderType(e.target.value)}>
                  <option value="market">Market</option>
                  <option value="limit">Limit</option>
                </select>
              </div>
              {orderType === 'limit' && (
                <div className="form-field">
                  <label>Limit Price</label>
                  <input type="number" value={limitPrice} onChange={(e) => setLimitPrice(e.target.value)} step="0.01" required />
                </div>
              )}
              <button type="submit" className={`btn ${side === 'buy' ? 'btn-buy' : 'btn-sell'}`} disabled={orderLoading}>
                {orderLoading ? 'Placing...' : side === 'buy' ? '🟢 Buy' : '🔴 Sell'}
              </button>
            </form>
            {orderResult && (
              <div className={`order-result ${orderResult.success ? 'order-success' : 'order-error'}`}>
                {orderResult.success
                  ? `Order placed: ${orderResult.data.side?.toUpperCase()} ${orderResult.data.qty} ${orderResult.data.symbol} (${orderResult.data.status})`
                  : `Error (${orderResult.side?.toUpperCase() || 'ORDER'}): ${orderResult.error}`}
              </div>
            )}
          </div>

          {/* Positions */}
          <div className="alpaca-section">
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <h3>Open Positions ({positions.length})</h3>
              {positions.length > 0 && (
                <button className="btn btn-danger" onClick={handleFlattenAll}>
                  <FiXCircle size={14} /> Flatten all
                </button>
              )}
            </div>
            {positions.length === 0 ? (
              <div className="empty-state">No open positions</div>
            ) : (
              <div className="alpaca-table">
                <div className="table-header">
                  <span>Symbol</span><span>Qty</span><span>Avg Entry</span><span>Current</span><span>Market Value</span><span>P&L</span><span>P&L %</span><span></span>
                </div>
                {positions.map((p) => (
                  <div key={p.asset_id} className="table-row">
                    <span className="row-symbol">{p.symbol}</span>
                    <span>{p.qty}</span>
                    <span>${Number(p.avg_entry_price).toFixed(2)}</span>
                    <span>${Number(p.current_price).toFixed(2)}</span>
                    <span>${Number(p.market_value).toLocaleString(undefined, { minimumFractionDigits: 2 })}</span>
                    <span style={{ color: Number(p.unrealized_pl) >= 0 ? '#10b981' : '#ef4444' }}>
                      ${Number(p.unrealized_pl).toFixed(2)}
                    </span>
                    <span style={{ color: Number(p.unrealized_plpc) >= 0 ? '#10b981' : '#ef4444' }}>
                      {(Number(p.unrealized_plpc) * 100).toFixed(2)}%
                    </span>
                    <span style={{ display: 'flex', gap: 4, justifyContent: 'flex-end' }}>
                      <button
                        className="btn-small"
                        onClick={() => handleClosePosition(p.symbol)}
                        title={`Close entire ${p.symbol} position at market`}
                      >
                        Close
                      </button>
                      <button
                        className="btn-small"
                        onClick={() => handleForceClose(p.symbol)}
                        title={`Force close: cancel all pending ${p.symbol} orders first, then close`}
                        style={{ opacity: 0.8 }}
                      >
                        Force
                      </button>
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Recent Orders */}
          <div className="alpaca-section">
            <h3>Recent Orders</h3>
            {orders.length === 0 ? (
              <div className="empty-state">No orders yet</div>
            ) : (
              <div className="alpaca-table">
                <div className="table-header">
                  <span>Symbol</span><span>Side</span><span>Qty</span><span>Type</span><span>Status</span><span>Filled</span><span></span>
                </div>
                {orders.map((o) => (
                  <div key={o.id} className="table-row">
                    <span className="row-symbol">{o.symbol}</span>
                    <span className={o.side === 'buy' ? 'text-green' : 'text-red'}>{o.side?.toUpperCase()}</span>
                    <span>{o.qty}</span>
                    <span>{o.type}</span>
                    <span className={`order-status status-${o.status}`}>{o.status}</span>
                    <span>{o.filled_avg_price ? `$${Number(o.filled_avg_price).toFixed(2)}` : '—'}</span>
                    <span>
                      {(o.status === 'new' || o.status === 'accepted' || o.status === 'pending_new') && (
                        <button className="btn-icon" onClick={() => handleCancel(o.id)} title="Cancel order">
                          <FiXCircle size={14} />
                        </button>
                      )}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
