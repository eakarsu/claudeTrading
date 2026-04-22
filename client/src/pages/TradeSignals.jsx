import React from 'react';
import FeaturePage from '../components/FeaturePage';

const fields = [
  { key: 'symbol', label: 'Symbol', type: 'text' },
  { key: 'signalType', label: 'Signal', type: 'text' },
  { key: 'strategy', label: 'Strategy', type: 'text' },
  { key: 'confidence', label: 'Confidence', type: 'number' },
  { key: 'entryPrice', label: 'Entry Price', type: 'number' },
  { key: 'targetPrice', label: 'Target Price', type: 'number' },
  { key: 'stopPrice', label: 'Stop Price', type: 'number' },
  { key: 'timeframe', label: 'Timeframe', type: 'text' },
  { key: 'status', label: 'Status', type: 'text' },
];

const defaultNew = { symbol: '', signalType: 'bullish', strategy: '', confidence: 0.5, entryPrice: 0, targetPrice: 0, stopPrice: 0, timeframe: '2 weeks', status: 'active' };

export default function TradeSignals() {
  return (
    <FeaturePage
      resource="trade-signals"
      title="Trade Signals"
      fields={fields}
      defaultNew={defaultNew}
      aiPrompt="Analyze all active trade signals. Which have the best risk/reward? Rank them by conviction. Any conflicting signals?"
      chartParams={(item) => ({
        entryPrice: item.entryPrice,
        targetPrice: item.targetPrice,
        stopPrice: item.stopPrice,
        action: item.signalType === 'bullish' ? 'buy' : 'sell',
        entryAt: item.createdAt || item.signalTime,
      })}
      cardRender={(item) => {
        const confPct = (item.confidence * 100).toFixed(0);
        const colorMap = { bullish: 'badge-green', bearish: 'badge-red', neutral: 'badge-yellow' };
        return (
          <>
            <div className="card-top">
              <span className="card-symbol">{item.symbol}</span>
              <span className={`card-badge ${colorMap[item.signalType] || 'badge-blue'}`}>{item.signalType}</span>
            </div>
            <div className="card-confidence">
              <div className="confidence-bar">
                <div className="confidence-fill" style={{ width: `${confPct}%`, background: item.confidence > 0.7 ? '#10b981' : item.confidence > 0.5 ? '#f59e0b' : '#ef4444' }} />
              </div>
              <span>{confPct}% confidence</span>
            </div>
            <div className="card-meta">
              <span>Entry: ${item.entryPrice?.toFixed(2)}</span>
              <span>Target: ${item.targetPrice?.toFixed(2)}</span>
            </div>
            <div className="card-meta">
              <span>Stop: ${item.stopPrice?.toFixed(2)}</span>
              <span>{item.timeframe}</span>
            </div>
          </>
        );
      }}
    />
  );
}
