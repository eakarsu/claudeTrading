import React from 'react';
import FeaturePage from '../components/FeaturePage';

const fields = [
  { key: 'symbol', label: 'Symbol', type: 'text' },
  { key: 'companyName', label: 'Company', type: 'text' },
  { key: 'price', label: 'Price', type: 'number' },
  { key: 'changePct', label: 'Change %', type: 'number' },
  { key: 'volume', label: 'Volume', type: 'text' },
  { key: 'sector', label: 'Sector', type: 'text' },
  { key: 'notes', label: 'Notes', type: 'text' },
];

const defaultNew = { symbol: '', companyName: '', price: 0, changePct: 0, volume: '', sector: '', notes: '' };

export default function Watchlist() {
  return (
    <FeaturePage
      resource="watchlist"
      title="Watchlist"
      fields={fields}
      defaultNew={defaultNew}
      aiPrompt="Analyze my watchlist. Which stocks look ready for entry? Any concerning patterns? Rank them by opportunity."
      cardRender={(item) => (
        <>
          <div className="card-top">
            <span className="card-symbol">{item.symbol}</span>
            <span className={`card-change ${item.changePct >= 0 ? 'positive' : 'negative'}`}>
              {item.changePct >= 0 ? '+' : ''}{item.changePct?.toFixed(2)}%
            </span>
          </div>
          <div className="card-company">{item.companyName}</div>
          <div className="card-price">${item.price?.toFixed(2)}</div>
          <div className="card-meta">
            <span>{item.sector}</span>
            <span>Vol: {item.volume}</span>
          </div>
        </>
      )}
    />
  );
}
