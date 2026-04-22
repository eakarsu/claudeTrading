import React from 'react';
import FeaturePage from '../components/FeaturePage';

const fields = [
  { key: 'symbol', label: 'Symbol', type: 'text' },
  { key: 'sentimentScore', label: 'Score (0-1)', type: 'number' },
  { key: 'source', label: 'Source', type: 'text' },
  { key: 'headline', label: 'Headline', type: 'text' },
  { key: 'bullishPct', label: 'Bullish %', type: 'number' },
  { key: 'bearishPct', label: 'Bearish %', type: 'number' },
];

const defaultNew = { symbol: '', sentimentScore: 0.5, source: '', headline: '', bullishPct: 50, bearishPct: 50 };

export default function SentimentPage() {
  return (
    <FeaturePage
      resource="sentiment"
      title="Sentiment Analysis"
      fields={fields}
      defaultNew={defaultNew}
      aiPrompt="Analyze market sentiment across all tracked stocks. Where is sentiment diverging from price action? Which stocks have extreme sentiment readings?"
      cardRender={(item) => {
        const score = item.sentimentScore;
        const color = score >= 0.7 ? '#10b981' : score >= 0.4 ? '#f59e0b' : '#ef4444';
        const label = score >= 0.7 ? 'Bullish' : score >= 0.4 ? 'Neutral' : 'Bearish';
        return (
          <>
            <div className="card-top">
              <span className="card-symbol">{item.symbol}</span>
              <span className="card-badge" style={{ background: color }}>{label}</span>
            </div>
            <div className="card-headline">{item.headline}</div>
            <div className="sentiment-bar">
              <div className="sentiment-bull" style={{ width: `${item.bullishPct}%` }}>{item.bullishPct}%</div>
              <div className="sentiment-bear" style={{ width: `${item.bearishPct}%` }}>{item.bearishPct}%</div>
            </div>
            <div className="card-meta">
              <span>{item.source}</span>
              <span>Score: {(score * 100).toFixed(0)}</span>
            </div>
          </>
        );
      }}
    />
  );
}
