import React from 'react';
import FeaturePage from '../components/FeaturePage';

const fields = [
  { key: 'politician', label: 'Politician', type: 'text' },
  { key: 'symbol', label: 'Symbol', type: 'text' },
  { key: 'action', label: 'Action', type: 'text' },
  { key: 'tradeDate', label: 'Trade Date', type: 'text' },
  { key: 'qty', label: 'Quantity', type: 'number' },
  { key: 'price', label: 'Price', type: 'number' },
  { key: 'totalValue', label: 'Total Value', type: 'number' },
  { key: 'status', label: 'Status', type: 'text' },
];

const defaultNew = { politician: '', symbol: '', action: 'buy', tradeDate: '', qty: 0, price: 0, totalValue: 0, status: 'pending' };

export default function CopyTrades() {
  return (
    <FeaturePage
      resource="copy-trades"
      title="Copy Trades"
      fields={fields}
      defaultNew={defaultNew}
      aiPrompt="Analyze all politician copy trades. Which politicians have the best track record? Are there sector patterns? Which trades should I follow?"
      chartParams={(item) => ({
        entryPrice: item.price,
        action: item.action,
        tradeDate: item.tradeDate,
      })}
      cardRender={(item) => (
        <>
          <div className="card-top">
            <span className="card-symbol">{item.symbol}</span>
            <span className={`card-badge ${item.action === 'buy' ? 'badge-green' : 'badge-red'}`}>{item.action}</span>
          </div>
          <div className="card-politician">{item.politician}</div>
          <div className="card-meta">
            <span>${item.totalValue?.toLocaleString()}</span>
            <span>{item.tradeDate}</span>
          </div>
          <div className="card-meta">
            <span>{item.qty} shares @ ${item.price?.toFixed(2)}</span>
            <span className={`card-badge ${item.status === 'executed' ? 'badge-blue' : 'badge-yellow'}`}>{item.status}</span>
          </div>
        </>
      )}
    />
  );
}
