import React from 'react';
import FeaturePage from '../components/FeaturePage';

const fields = [
  { key: 'symbol', label: 'Symbol', type: 'text' },
  { key: 'positionSize', label: 'Position Size $', type: 'number' },
  { key: 'riskLevel', label: 'Risk Level', type: 'text' },
  { key: 'maxLoss', label: 'Max Loss $', type: 'number' },
  { key: 'riskRewardRatio', label: 'Risk/Reward', type: 'number' },
  { key: 'volatility', label: 'Volatility %', type: 'number' },
  { key: 'notes', label: 'Notes', type: 'text' },
];

const defaultNew = { symbol: '', positionSize: 0, riskLevel: 'medium', maxLoss: 0, riskRewardRatio: 2.0, volatility: 0, notes: '' };

export default function RiskAssessments() {
  return (
    <FeaturePage
      resource="risk-assessments"
      title="Risk Assessments"
      fields={fields}
      defaultNew={defaultNew}
      aiPrompt="Analyze my overall risk exposure. Am I over-concentrated? What's my total max loss? Suggest position sizing changes and hedging strategies."
      cardRender={(item) => {
        const riskColors = { low: '#10b981', medium: '#f59e0b', high: '#ef4444', 'very high': '#dc2626' };
        return (
          <>
            <div className="card-top">
              <span className="card-symbol">{item.symbol}</span>
              <span className="card-badge" style={{ background: riskColors[item.riskLevel] || '#6b7280' }}>
                {item.riskLevel}
              </span>
            </div>
            <div className="card-meta">
              <span>Position: ${item.positionSize?.toLocaleString()}</span>
              <span>Max Loss: ${item.maxLoss?.toLocaleString()}</span>
            </div>
            <div className="card-meta">
              <span>R/R: {item.riskRewardRatio?.toFixed(1)}</span>
              <span>Vol: {item.volatility?.toFixed(1)}%</span>
            </div>
            <div className="card-notes">{item.notes}</div>
          </>
        );
      }}
    />
  );
}
