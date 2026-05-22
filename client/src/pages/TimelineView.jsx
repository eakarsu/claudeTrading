import React from 'react';

const stages = [
  { label: 'Intake', value: 28 },
  { label: 'Review', value: 46 },
  { label: 'Decision', value: 64 },
  { label: 'Action', value: 78 },
  { label: 'Outcome', value: 91 },
];

function TimelineView() {
  const width = 620;
  const height = 260;
  const max = Math.max(...stages.map((stage) => stage.value));
  const points = stages.map((stage, index) => {
    const x = 48 + index * 130;
    const y = 202 - (stage.value / max) * 142;
    return { ...stage, x, y };
  });

  return (
    <main style={{ padding: 24, color: '#172033' }}>
      <p style={{ margin: 0, color: '#64748b', fontSize: 13, fontWeight: 700, textTransform: 'uppercase' }}>Custom visualization</p>
      <h1 style={{ margin: '6px 0 18px', fontSize: 30 }}>claude Trading Timeline View</h1>
      <section style={{ display: 'grid', gridTemplateColumns: 'minmax(280px, 1fr) 260px', gap: 18 }}>
        <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Timeline view of operational stages" style={{ width: '100%', minHeight: 300, border: '1px solid #d7dde8', borderRadius: 8, background: '#f8fafc' }}>
          {[60, 100, 140, 180, 220].map((y) => <line key={y} x1="42" x2="580" y1={y} y2={y} stroke="#e2e8f0" />)}
          <polyline points={points.map((point) => `${point.x},${point.y}`).join(' ')} fill="none" stroke="#2563eb" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" />
          {points.map((point) => (
            <g key={point.label}>
              <circle cx={point.x} cy={point.y} r="8" fill="#2563eb" stroke="#ffffff" strokeWidth="3" />
              <text x={point.x} y="238" textAnchor="middle" fill="#475569" fontSize="13">{point.label}</text>
              <text x={point.x} y={point.y - 16} textAnchor="middle" fill="#172033" fontSize="13" fontWeight="700">{point.value}</text>
            </g>
          ))}
        </svg>
        <div style={{ display: 'grid', gap: 10 }}>
          {stages.map((stage) => (
            <div key={stage.label} style={{ border: '1px solid #d7dde8', borderRadius: 8, padding: 12, background: '#ffffff' }}>
              <strong>{stage.label}</strong>
              <div style={{ height: 8, background: '#e2e8f0', borderRadius: 999, overflow: 'hidden', marginTop: 8 }}>
                <div style={{ width: `${stage.value}%`, height: '100%', background: '#2563eb' }} />
              </div>
            </div>
          ))}
        </div>
      </section>
    </main>
  );
}

export default TimelineView;
