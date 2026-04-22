import React from 'react';
import FeaturePage from '../components/FeaturePage';

const fields = [
  { key: 'symbol', label: 'Symbol', type: 'text' },
  { key: 'companyName', label: 'Company', type: 'text' },
  { key: 'qty', label: 'Quantity', type: 'number' },
  { key: 'avgPrice', label: 'Avg Price', type: 'number' },
  { key: 'currentPrice', label: 'Current Price', type: 'number' },
  { key: 'pnl', label: 'P&L', type: 'number' },
  { key: 'allocation', label: 'Allocation %', type: 'number' },
];

const defaultNew = { symbol: '', companyName: '', qty: 0, avgPrice: 0, currentPrice: 0, pnl: 0, allocation: 0 };

export default function Portfolio() {
  return (
    <FeaturePage
      resource="portfolio"
      title="Portfolio"
      fields={fields}
      defaultNew={defaultNew}
      aiPrompt="Analyze my full portfolio. How diversified am I? What's my total risk? Suggest rebalancing moves and which positions to trim or add to."
      chartParams={(item) => ({
        entryPrice: item.avgPrice,
        currentPrice: item.currentPrice,
        action: 'buy',
        entryAt: item.purchaseDate || item.createdAt,
      })}
      cardRender={(item) => {
        const pnlPct = item.avgPrice ? ((item.currentPrice - item.avgPrice) / item.avgPrice * 100) : 0;
        return (
          <>
            <div className="card-top">
              <span className="card-symbol">{item.symbol}</span>
              <span className="card-allocation">{item.allocation?.toFixed(1)}%</span>
            </div>
            <div className="card-company">{item.companyName}</div>
            <div className="card-meta">
              <span>Avg: ${item.avgPrice?.toFixed(2)}</span>
              <span>Now: ${item.currentPrice?.toFixed(2)}</span>
            </div>
            <div className={`card-pnl ${item.pnl >= 0 ? 'positive' : 'negative'}`}>
              {item.pnl >= 0 ? '+' : ''}${item.pnl?.toFixed(2)} ({pnlPct >= 0 ? '+' : ''}{pnlPct.toFixed(1)}%)
            </div>
            <div className="card-meta">
              <span>{item.qty} shares</span>
              <span>${(item.currentPrice * item.qty).toLocaleString()}</span>
            </div>
          </>
        );
      }}
    />
  );
}
