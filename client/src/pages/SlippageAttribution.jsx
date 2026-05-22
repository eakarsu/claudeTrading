import React, { useEffect, useState } from 'react';

export default function SlippageAttribution() {
  const [data, setData] = useState(null);

  useEffect(() => {
    fetch('/api/slippage-attribution', {
      headers: { Authorization: `Bearer ${localStorage.getItem('token') || ''}` },
    })
      .then((res) => res.json())
      .then(setData)
      .catch(() => setData({ error: 'Unable to load slippage attribution.' }));
  }, []);

  if (!data) return <div style={{ padding: 24 }}>Loading...</div>;

  return (
    <div className="page">
      <h1>Slippage Attribution</h1>
      <p className="muted">Execution-quality breakdown by spread expansion, market impact, latency, venue, and strategy.</p>
      <div className="stats-grid">
        <div className="stat-card"><span>Avg Slippage</span><strong>{data.summary?.avgSlippageBps} bps</strong></div>
        <div className="stat-card"><span>Affected Trades</span><strong>{data.summary?.affectedTrades}</strong></div>
        <div className="stat-card"><span>Venue Drift</span><strong>{data.summary?.venueDrift}</strong></div>
        <div className="stat-card"><span>Recovery</span><strong>${data.summary?.recoveryOpportunity}</strong></div>
      </div>
      <div className="card">
        <h2>Attribution Buckets</h2>
        {data.buckets?.map((bucket) => (
          <div key={bucket.cause} className="row">
            <strong>{bucket.cause}</strong>
            <span>{bucket.trades} trades</span>
            <span>{bucket.bps} bps</span>
            <span>{bucket.action}</span>
          </div>
        ))}
      </div>
      <div className="card">
        <h2>Controls</h2>
        <ul>{data.controls?.map((control) => <li key={control}>{control}</li>)}</ul>
      </div>
    </div>
  );
}
