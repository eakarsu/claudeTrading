import React from 'react';
import FeaturePage from '../components/FeaturePage';

const fields = [
  { key: 'symbol', label: 'Symbol', type: 'text' },
  { key: 'qty', label: 'Quantity', type: 'number' },
  { key: 'entryPrice', label: 'Entry Price', type: 'number' },
  { key: 'currentPrice', label: 'Current Price', type: 'number' },
  { key: 'stopLossPct', label: 'Stop Loss %', type: 'number' },
  { key: 'trailPct', label: 'Trail %', type: 'number' },
  { key: 'floorPrice', label: 'Floor Price', type: 'number' },
  { key: 'highestPrice', label: 'Highest Price', type: 'number' },
  { key: 'status', label: 'Status', type: 'text' },
];

const defaultNew = { symbol: '', qty: 10, entryPrice: 0, currentPrice: 0, stopLossPct: 10, trailPct: 5, floorPrice: 0, highestPrice: 0, status: 'active' };

export default function TrailingStops() {
  return (
    <FeaturePage
      resource="trailing-stops"
      title="Trailing Stops"
      fields={fields}
      defaultNew={defaultNew}
      aiPrompt="Analyze all my trailing stop positions. Which ones are performing well? Which need attention? Any suggestions for adjusting parameters?"
      chartParams={(item) => ({
        entryPrice: item.entryPrice,
        currentPrice: item.currentPrice,
        floorPrice: item.floorPrice,
        stopPrice: item.floorPrice,
        action: 'buy',
        entryAt: item.createdAt,
      })}
      cardRender={(item) => {
        const pnl = ((item.currentPrice - item.entryPrice) / item.entryPrice * 100);
        return (
          <>
            <div className="card-top">
              <span className="card-symbol">{item.symbol}</span>
              <span className={`card-badge ${item.status === 'active' ? 'badge-green' : 'badge-red'}`}>{item.status}</span>
            </div>
            <div className="card-price">${item.currentPrice?.toFixed(2)}</div>
            <div className="card-meta">
              <span>Entry: ${item.entryPrice?.toFixed(2)}</span>
              <span className={pnl >= 0 ? 'positive' : 'negative'}>{pnl >= 0 ? '+' : ''}{pnl.toFixed(1)}%</span>
            </div>
            <div className="card-meta">
              <span>Floor: ${item.floorPrice?.toFixed(2)}</span>
              <span>{item.qty} shares</span>
            </div>
          </>
        );
      }}
    />
  );
}
