import React from 'react';

const signals = [
  { label: 'Demand', value: 72, delta: '+12%' },
  { label: 'Risk', value: 44, delta: '-8%' },
  { label: 'Capacity', value: 86, delta: '+6%' },
  { label: 'Quality', value: 63, delta: '+4%' },
  { label: 'Velocity', value: 58, delta: '+9%' },
];

const trend = [18, 32, 28, 46, 41, 57, 69, 64, 78, 72, 88, 83];
const maxTrend = Math.max(...trend);
const points = trend.map((value, index) => {
  const x = 28 + index * 42;
  const y = 172 - (value / maxTrend) * 128;
  return `${x},${y}`;
}).join(' ');

function TimelineView() {
  return (
    <section style={{ padding: 24, color: '#172033' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 16, alignItems: 'flex-end', flexWrap: 'wrap' }}>
        <div>
          <p style={{ margin: 0, color: '#64748b', fontSize: 13, fontWeight: 700, textTransform: 'uppercase' }}>Custom visualization</p>
          <h1 style={{ margin: '6px 0 0', fontSize: 30 }}> claude Trading Insight Map</h1>
        </div>
        <div style={{ padding: '10px 14px', border: '1px solid #d7dde8', borderRadius: 8, background: '#f8fafc' }}>Live scenario model</div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(280px, 1.3fr) minmax(260px, .7fr)', gap: 18, marginTop: 20 }}>
        <div style={{ border: '1px solid #d7dde8', borderRadius: 8, padding: 18, background: '#ffffff' }}>
          <svg viewBox="0 0 520 220" role="img" aria-label="Custom trend visualization" style={{ width: '100%', height: 260 }}>
            <rect x="0" y="0" width="520" height="220" rx="8" fill="#f8fafc" />
            {[44, 76, 108, 140, 172].map((y) => (
              <line key={y} x1="28" x2="492" y1={y} y2={y} stroke="#e2e8f0" strokeWidth="1" />
            ))}
            <polyline points={points} fill="none" stroke="#0f766e" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" />
            {trend.map((value, index) => {
              const x = 28 + index * 42;
              const y = 172 - (value / maxTrend) * 128;
              return <circle key={index} cx={x} cy={y} r="5" fill="#14b8a6" stroke="#ffffff" strokeWidth="2" />;
            })}
            <text x="28" y="204" fill="#64748b" fontSize="12">Start</text>
            <text x="448" y="204" fill="#64748b" fontSize="12">Current</text>
          </svg>
        </div>

        <div style={{ display: 'grid', gap: 12 }}>
          {signals.map((signal) => (
            <div key={signal.label} style={{ border: '1px solid #d7dde8', borderRadius: 8, padding: 14, background: '#ffffff' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
                <strong>{signal.label}</strong>
                <span style={{ color: signal.delta.startsWith('+') ? '#047857' : '#b45309' }}>{signal.delta}</span>
              </div>
              <div style={{ height: 10, borderRadius: 999, background: '#e2e8f0', overflow: 'hidden' }}>
                <div style={{ width: `${signal.value}%`, height: '100%', background: '#0f766e' }} />
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

export default function CodexCustomVizFeature() {
  return <TimelineView />;
}
