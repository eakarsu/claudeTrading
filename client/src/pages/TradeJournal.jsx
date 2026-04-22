import React from 'react';
import FeaturePage from '../components/FeaturePage';

const fields = [
  { key: 'symbol', label: 'Symbol', type: 'text' },
  { key: 'action', label: 'Action', type: 'text' },
  { key: 'qty', label: 'Quantity', type: 'number' },
  { key: 'entryPrice', label: 'Entry Price', type: 'number' },
  { key: 'exitPrice', label: 'Exit Price', type: 'number' },
  { key: 'tradeDate', label: 'Date', type: 'text' },
  { key: 'pnl', label: 'P&L', type: 'number' },
  { key: 'strategy', label: 'Strategy', type: 'text' },
  { key: 'notes', label: 'Notes', type: 'text' },
];

const defaultNew = { symbol: '', action: 'buy', qty: 0, entryPrice: 0, exitPrice: 0, tradeDate: '', pnl: 0, strategy: '', notes: '' };

export default function TradeJournalPage() {
  return (
    <FeaturePage
      resource="trade-journal"
      title="Trade Journal"
      fields={fields}
      defaultNew={defaultNew}
      aiPrompt="Review my trade journal. What patterns do you see in my winning vs losing trades? Which strategies perform best? What should I improve?"
      chartParams={(item) => ({
        entryPrice: item.entryPrice,
        exitPrice: item.exitPrice,
        action: item.action,
        tradeDate: item.tradeDate,
      })}
      cardRender={(item) => (
        <>
          <div className="card-top">
            <span className="card-symbol">{item.symbol}</span>
            <span className={`card-badge ${item.action === 'buy' ? 'badge-green' : 'badge-red'}`}>{item.action}</span>
          </div>
          <div className={`card-pnl ${item.pnl >= 0 ? 'positive' : 'negative'}`}>
            {item.pnl >= 0 ? '+' : ''}${item.pnl?.toFixed(2)}
          </div>
          <div className="card-meta">
            <span>{item.strategy}</span>
            <span>{item.tradeDate}</span>
          </div>
          <div className="card-meta">
            <span>{item.qty} shares</span>
            <span>${item.entryPrice?.toFixed(2)} → ${item.exitPrice?.toFixed(2)}</span>
          </div>
        </>
      )}
    />
  );
}
