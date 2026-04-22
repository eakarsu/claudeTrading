import React from 'react';
import FeaturePage from '../components/FeaturePage';

const fields = [
  { key: 'symbol', label: 'Symbol', type: 'text' },
  { key: 'targetPrice', label: 'Target Price', type: 'number' },
  { key: 'direction', label: 'Direction', type: 'text' },
  { key: 'currentPrice', label: 'Current Price', type: 'number' },
  { key: 'status', label: 'Status', type: 'text' },
  { key: 'notes', label: 'Notes', type: 'text' },
];

const defaultNew = { symbol: '', targetPrice: 0, direction: 'above', currentPrice: 0, status: 'active', notes: '' };

export default function PriceAlerts() {
  return (
    <FeaturePage
      resource="price-alerts"
      title="Price Alerts"
      fields={fields}
      defaultNew={defaultNew}
      aiPrompt="Review my price alerts. Which alerts are close to triggering? Are these price levels technically significant? Suggest new alert levels I should add."
      cardRender={(item) => {
        const distance = ((item.targetPrice - item.currentPrice) / item.currentPrice * 100);
        return (
          <>
            <div className="card-top">
              <span className="card-symbol">{item.symbol}</span>
              <span className={`card-badge ${item.direction === 'above' ? 'badge-green' : 'badge-red'}`}>
                {item.direction === 'above' ? '↑ Above' : '↓ Below'}
              </span>
            </div>
            <div className="card-price">Target: ${item.targetPrice?.toFixed(2)}</div>
            <div className="card-meta">
              <span>Current: ${item.currentPrice?.toFixed(2)}</span>
              <span className={distance > 0 ? 'positive' : 'negative'}>{distance.toFixed(1)}% away</span>
            </div>
            <div className="card-notes">{item.notes}</div>
          </>
        );
      }}
    />
  );
}
