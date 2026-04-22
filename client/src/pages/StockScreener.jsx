import React, { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import FeaturePage from '../components/FeaturePage';
import * as api from '../api';

const fields = [
  { key: 'symbol', label: 'Symbol', type: 'text' },
  { key: 'companyName', label: 'Company', type: 'text' },
  { key: 'sector', label: 'Sector', type: 'text' },
  { key: 'marketCap', label: 'Market Cap', type: 'text' },
  { key: 'peRatio', label: 'P/E Ratio', type: 'number' },
  { key: 'dividendYield', label: 'Dividend %', type: 'number' },
  { key: 'aiScore', label: 'AI Score', type: 'number' },
];

const defaultNew = { symbol: '', companyName: '', sector: '', marketCap: '', peRatio: 0, dividendYield: 0, aiScore: 5 };

export default function StockScreener() {
  // Theme preset — when set, constrain the rendered list to symbols that
  // belong to the selected AI theme. Pulled once from /api/themes; the filter
  // is computed client-side so switching themes is instant.
  const [themeSlug, setThemeSlug] = useState('');
  const { data: themesResp } = useQuery({ queryKey: ['themes'], queryFn: api.listThemes });
  const themes = themesResp?.items || [];
  const activeThemeSymbols = useMemo(() => {
    if (!themeSlug) return null;
    const t = themes.find((x) => x.slug === themeSlug);
    if (!t) return null;
    return new Set(t.constituents.map((c) => c.symbol.toUpperCase()));
  }, [themeSlug, themes]);

  return (
    <FeaturePage
      resource="stock-screener"
      title="Stock Screener"
      fields={fields}
      defaultNew={defaultNew}
      aiPrompt="Screen these stocks and rank them. Which are the best value plays? Which are growth plays? Give me your top 5 picks with reasoning."
      filterBar={
        <div className="screener-filter-bar">
          <label>
            AI Theme preset:{' '}
            <select value={themeSlug} onChange={(e) => setThemeSlug(e.target.value)}>
              <option value="">— All stocks —</option>
              {themes.map((t) => (
                <option key={t.slug} value={t.slug}>{t.name}</option>
              ))}
            </select>
          </label>
          {activeThemeSymbols && (
            <span className="muted">
              {' '}showing {activeThemeSymbols.size} constituent symbol(s)
            </span>
          )}
        </div>
      }
      filterItems={(items) => {
        if (!activeThemeSymbols) return items;
        return items.filter((it) => activeThemeSymbols.has(String(it.symbol || '').toUpperCase()));
      }}
      cardRender={(item) => (
        <>
          <div className="card-top">
            <span className="card-symbol">{item.symbol}</span>
            <span className="card-score">
              <span className="score-circle" style={{ background: item.aiScore >= 8 ? '#10b981' : item.aiScore >= 6 ? '#f59e0b' : '#ef4444' }}>
                {item.aiScore?.toFixed(1)}
              </span>
            </span>
          </div>
          <div className="card-company">{item.companyName}</div>
          <div className="card-meta">
            <span>{item.sector}</span>
            <span>MCap: {item.marketCap}</span>
          </div>
          <div className="card-meta">
            <span>P/E: {item.peRatio?.toFixed(1)}</span>
            <span>Div: {item.dividendYield?.toFixed(2)}%</span>
          </div>
        </>
      )}
    />
  );
}
