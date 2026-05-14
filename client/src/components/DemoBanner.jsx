import React, { useEffect, useState } from 'react';
import { FiAlertTriangle } from 'react-icons/fi';
import { getAutoTraderMode } from '../api';

/**
 * Demo-mode banner. Shown on all pages (except /login) so users never forget
 * that this is paper-trading against seeded data, not real money.
 *
 * Also fetches the server's TRADING_MODE — if the server is in LIVE mode the
 * banner flips red to make the distinction unmistakable.
 */
export default function DemoBanner() {
  const [mode, setMode] = useState(null);
  useEffect(() => {
    // Best-effort: ignore failures (unauthenticated, server unreachable, etc.)
    getAutoTraderMode().then(setMode).catch(() => {});
  }, []);
  const isLive = mode?.isLive === true;
  const styled = isLive ? { ...styles.banner, ...styles.liveBanner } : styles.banner;
  return (
    <div className="demo-banner" style={styled}>
      <FiAlertTriangle size={14} />
      <span>
        {isLive
          ? 'LIVE TRADING — orders will be sent to a real Alpaca account. Paper-vs-live guardrail enforced.'
          : 'Demo mode — all trades are paper (Alpaca sandbox) and portfolio figures are seeded data. Not financial advice.'}
      </span>
    </div>
  );
}

const styles = {
  banner: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    padding: '6px 14px',
    background: '#2a1e08',
    color: '#f3c670',
    borderBottom: '1px solid #4a3a14',
    fontSize: 12,
    letterSpacing: 0.2,
  },
  liveBanner: {
    background: '#3a0a0a',
    color: '#ff8b8b',
    borderBottom: '1px solid #6a1414',
    fontWeight: 600,
  },
};
