import React, { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { FiRefreshCw } from 'react-icons/fi';
import FeaturePage from '../components/FeaturePage';
import { syncMarketNews } from '../api';

const fields = [
  { key: 'title', label: 'Title', type: 'text' },
  { key: 'summary', label: 'Summary', type: 'text' },
  { key: 'source', label: 'Source', type: 'text' },
  { key: 'symbol', label: 'Symbol', type: 'text' },
  { key: 'sentiment', label: 'Sentiment', type: 'text' },
  { key: 'publishedAt', label: 'Published', type: 'text' },
  { key: 'url', label: 'URL', type: 'text' },
];

const defaultNew = { title: '', summary: '', source: '', symbol: '', sentiment: 'neutral', publishedAt: '', url: '' };

// Only follow links that look like real http(s) URLs. User-authored rows
// can leave `url` blank or paste junk — treat those as plain-text.
function isSafeUrl(u) {
  if (!u || typeof u !== 'string') return false;
  try {
    const parsed = new URL(u);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

function SyncButton() {
  const [busy, setBusy] = useState(false);
  const qc = useQueryClient();
  async function onClick() {
    setBusy(true);
    try {
      const r = await syncMarketNews({ category: 'general', max: 25 });
      if (r.error === 'no_api_key') {
        alert('Real news sync needs FINNHUB_API_KEY in .env and NEWS_PROVIDER=finnhub. See USER_MANUAL §6.3.');
      } else if (r.provider === 'none') {
        alert('NEWS_PROVIDER is not configured. Set NEWS_PROVIDER=finnhub in .env to pull real articles.');
      } else {
        alert(`Synced: +${r.inserted} new, ${r.skipped} already existed.`);
        qc.invalidateQueries({ queryKey: ['market-news', 'list'] });
      }
    } catch (e) {
      alert(`Sync failed: ${e.message}`);
    } finally {
      setBusy(false);
    }
  }
  return (
    <button className="btn btn-secondary" onClick={onClick} disabled={busy}>
      <FiRefreshCw size={16} /> {busy ? 'Syncing…' : 'Sync real news'}
    </button>
  );
}

export default function MarketNewsPage() {
  return (
    <FeaturePage
      resource="market-news"
      title="Market News"
      fields={fields}
      defaultNew={defaultNew}
      extraActions={<SyncButton />}
      aiPrompt="Summarize all market news. What are the key themes? Which news items will have the biggest market impact? Give me actionable takeaways."
      cardRender={(item) => {
        const sentColors = { bullish: 'badge-green', bearish: 'badge-red', neutral: 'badge-yellow' };
        const linkable = isSafeUrl(item.url);
        return (
          <>
            <div className="card-top">
              <span className="card-symbol">{item.symbol}</span>
              <span className={`card-badge ${sentColors[item.sentiment] || 'badge-blue'}`}>{item.sentiment}</span>
            </div>
            <div className="card-title">
              {linkable ? (
                <a href={item.url} target="_blank" rel="noopener noreferrer" className="card-title-link">
                  {item.title}
                </a>
              ) : item.title}
            </div>
            <div className="card-summary">{item.summary}</div>
            <div className="card-meta">
              <span>{item.source}</span>
              <span>{item.publishedAt}</span>
              {linkable && (
                <a href={item.url} target="_blank" rel="noopener noreferrer" className="card-read-more">
                  Read article ↗
                </a>
              )}
            </div>
          </>
        );
      }}
    />
  );
}
