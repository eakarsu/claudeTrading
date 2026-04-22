import React from 'react';
import { FiAlertTriangle } from 'react-icons/fi';

/**
 * Demo-mode banner. Shown on all pages (except /login) so users never forget
 * that this is paper-trading against seeded data, not real money.
 */
export default function DemoBanner() {
  return (
    <div className="demo-banner" style={styles.banner}>
      <FiAlertTriangle size={14} />
      <span>
        Demo mode — all trades are paper (Alpaca sandbox) and portfolio figures are seeded data. Not
        financial advice.
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
};
