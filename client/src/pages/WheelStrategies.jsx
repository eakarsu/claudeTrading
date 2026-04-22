import React from 'react';
import FeaturePage from '../components/FeaturePage';

const fields = [
  { key: 'symbol', label: 'Symbol', type: 'text' },
  { key: 'stage', label: 'Stage', type: 'text' },
  { key: 'strikePrice', label: 'Strike Price', type: 'number' },
  { key: 'expiration', label: 'Expiration', type: 'text' },
  { key: 'premium', label: 'Premium', type: 'number' },
  { key: 'costBasis', label: 'Cost Basis', type: 'number' },
  { key: 'contracts', label: 'Contracts', type: 'number' },
  { key: 'status', label: 'Status', type: 'text' },
];

const defaultNew = { symbol: '', stage: 'selling_puts', strikePrice: 0, expiration: '', premium: 0, costBasis: 0, contracts: 1, status: 'active' };

export default function WheelStrategies() {
  return (
    <FeaturePage
      resource="wheel-strategies"
      title="Wheel Strategies"
      fields={fields}
      defaultNew={defaultNew}
      aiPrompt="Review all my wheel strategy positions. Which ones are generating the most premium? Should I roll any contracts? What's my total premium income?"
      chartParams={(item) => ({
        strikePrice: item.strikePrice,
        entryPrice: item.costBasis || item.strikePrice,
        currentPrice: item.strikePrice,
      })}
      cardRender={(item) => (
        <>
          <div className="card-top">
            <span className="card-symbol">{item.symbol}</span>
            <span className={`card-badge ${item.stage === 'selling_puts' ? 'badge-purple' : 'badge-blue'}`}>
              {item.stage === 'selling_puts' ? 'Selling Puts' : 'Selling Calls'}
            </span>
          </div>
          <div className="card-price">Strike: ${item.strikePrice?.toFixed(2)}</div>
          <div className="card-meta">
            <span>Premium: ${item.premium?.toFixed(2)}</span>
            <span>Exp: {item.expiration}</span>
          </div>
          <div className="card-meta">
            <span>{item.contracts} contract(s)</span>
            <span className={`card-badge ${item.status === 'active' ? 'badge-green' : 'badge-red'}`}>{item.status}</span>
          </div>
        </>
      )}
    />
  );
}
