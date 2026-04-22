import React from 'react';
import FeaturePage from '../components/FeaturePage';

const fields = [
  { key: 'symbol', label: 'Symbol', type: 'text' },
  { key: 'optionType', label: 'Type', type: 'text' },
  { key: 'strike', label: 'Strike', type: 'number' },
  { key: 'expiration', label: 'Expiration', type: 'text' },
  { key: 'premium', label: 'Premium', type: 'number' },
  { key: 'iv', label: 'IV %', type: 'number' },
  { key: 'delta', label: 'Delta', type: 'number' },
  { key: 'openInterest', label: 'Open Interest', type: 'number' },
];

const defaultNew = { symbol: '', optionType: 'call', strike: 0, expiration: '', premium: 0, iv: 0, delta: 0, openInterest: 0 };

export default function OptionsChainPage() {
  return (
    <FeaturePage
      resource="options-chain"
      title="Options Chain"
      fields={fields}
      defaultNew={defaultNew}
      aiPrompt="Analyze the options chain data. Which options are mispriced? Where is IV high/low? Suggest the best options strategies based on current conditions."
      chartParams={(item) => ({
        strikePrice: item.strike,
        currentPrice: item.strike * (item.optionType === 'call' ? 0.95 : 1.05),
      })}
      cardRender={(item) => (
        <>
          <div className="card-top">
            <span className="card-symbol">{item.symbol}</span>
            <span className={`card-badge ${item.optionType === 'call' ? 'badge-green' : 'badge-red'}`}>
              {item.optionType?.toUpperCase()}
            </span>
          </div>
          <div className="card-price">Strike: ${item.strike?.toFixed(2)}</div>
          <div className="card-meta">
            <span>Premium: ${item.premium?.toFixed(2)}</span>
            <span>IV: {item.iv?.toFixed(1)}%</span>
          </div>
          <div className="card-meta">
            <span>Delta: {item.delta?.toFixed(2)}</span>
            <span>OI: {item.openInterest?.toLocaleString()}</span>
          </div>
          <div className="card-meta">
            <span>Exp: {item.expiration}</span>
          </div>
        </>
      )}
    />
  );
}
