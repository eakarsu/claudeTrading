/**
 * Exchange adapter interface — the contract every adapter must implement.
 *
 * Our existing broker integration is Alpaca-only (US equities). This layer
 * sets up the plumbing for additional exchanges (especially crypto via
 * ccxt) so strategies can target different markets without rewriting.
 *
 * Each adapter exposes:
 *   - id: string
 *   - name: human label
 *   - kind: 'equity' | 'crypto' | 'fx'
 *   - getBars(symbol, timeframe, limit)    → [{time, open, high, low, close, volume}]
 *   - getLatestQuote(symbol)               → {bid, ask, last}
 *   - getPositions()                       → [{symbol, qty, avgPrice, currentPrice, pnl}]
 *   - placeOrder(params)                   → {id, status}
 *   - cancelOrder(id)                      → void
 *
 * Adapters may implement `supports: { brackets, shorting, fractional, … }`
 * so strategies can introspect capabilities.
 */

export class BaseExchangeAdapter {
  constructor({ id, name, kind }) {
    this.id = id; this.name = name; this.kind = kind;
    this.supports = { brackets: false, shorting: false, fractional: false };
  }
  async getBars() { throw new Error(`${this.id}: getBars not implemented`); }
  async getLatestQuote() { throw new Error(`${this.id}: getLatestQuote not implemented`); }
  async getPositions() { return []; }
  async placeOrder() { throw new Error(`${this.id}: placeOrder not implemented`); }
  async cancelOrder() { throw new Error(`${this.id}: cancelOrder not implemented`); }
}
