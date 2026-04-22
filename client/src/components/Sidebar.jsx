import React, { useEffect, useState } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import { FiHome, FiTrendingUp, FiCopy, FiRefreshCw, FiEye, FiBook, FiBell,
  FiZap, FiSearch, FiShield, FiBriefcase, FiSmile, FiLayers, FiRss, FiCpu, FiLogOut, FiDollarSign, FiActivity, FiTarget, FiCalendar, FiUser, FiPlayCircle, FiInbox, FiCompass, FiBookOpen, FiLink, FiSliders, FiAlertTriangle, FiDatabase, FiGitBranch, FiGlobe, FiBarChart2, FiRadio, FiServer, FiCode, FiPieChart, FiTool } from 'react-icons/fi';
import { logout as apiLogout, getUnreadNotificationCount } from '../api';

const links = [
  { to: '/', icon: FiHome, label: 'Dashboard' },
  { to: '/trailing-stops', icon: FiTrendingUp, label: 'Trailing Stops' },
  { to: '/copy-trades', icon: FiCopy, label: 'Copy Trading' },
  { to: '/wheel-strategies', icon: FiRefreshCw, label: 'Wheel Strategy' },
  { to: '/watchlist', icon: FiEye, label: 'Watchlist' },
  { to: '/trade-journal', icon: FiBook, label: 'Trade Journal' },
  { to: '/price-alerts', icon: FiBell, label: 'Price Alerts' },
  { to: '/trade-signals', icon: FiZap, label: 'Trade Signals' },
  { to: '/stock-screener', icon: FiSearch, label: 'Stock Screener' },
  { to: '/risk-assessments', icon: FiShield, label: 'Risk Calculator' },
  { to: '/portfolio', icon: FiBriefcase, label: 'Portfolio' },
  { to: '/sentiment', icon: FiSmile, label: 'Sentiment' },
  { to: '/options-chain', icon: FiLayers, label: 'Options Chain' },
  { to: '/market-news', icon: FiRss, label: 'Market News' },
  { to: '/signal-charts', icon: FiActivity, label: 'Signal Charts' },
  { to: '/alpaca-trading', icon: FiDollarSign, label: 'Alpaca Trading' },
  { to: '/strategy-lab', icon: FiTarget, label: 'Strategy Lab' },
  { to: '/strategy-editor', icon: FiCode, label: 'Strategy Editor' },
  { to: '/leverage', icon: FiTrendingUp, label: 'Leverage' },
  { to: '/hyperopt', icon: FiSliders, label: 'Hyperopt' },
  { to: '/hyperopt-advanced', icon: FiSliders, label: 'Hyperopt Advanced' },
  { to: '/strategy-audit', icon: FiAlertTriangle, label: 'Strategy Audit' },
  { to: '/protections', icon: FiShield, label: 'Protections' },
  { to: '/edge', icon: FiTarget, label: 'Edge' },
  { to: '/saved-backtests', icon: FiDatabase, label: 'Saved Backtests' },
  { to: '/backtest-analysis', icon: FiPieChart, label: 'Backtest Analysis' },
  { to: '/strategy-migrator', icon: FiGitBranch, label: 'Strategy Migrator' },
  { to: '/freqai-models', icon: FiCpu, label: 'FreqAI Models' },
  { to: '/rl-lite', icon: FiCpu, label: 'RL-lite' },
  { to: '/freqai-sidecar', icon: FiCpu, label: 'FreqAI Sidecar' },
  { to: '/exchanges', icon: FiGlobe, label: 'Exchanges' },
  { to: '/plots', icon: FiBarChart2, label: 'Plots' },
  { to: '/producer-consumer', icon: FiRadio, label: 'Signal Feed' },
  { to: '/freqtrade-api', icon: FiServer, label: 'Freqtrade API' },
  { to: '/orderflow', icon: FiActivity, label: 'Orderflow' },
  { to: '/utilities', icon: FiTool, label: 'Utilities' },
  { to: '/webhooks', icon: FiLink, label: 'Webhooks' },
  { to: '/event-calendar', icon: FiCalendar, label: 'Event Calendar' },
  { to: '/audit-log', icon: FiShield, label: 'Audit Log' },
  { to: '/trade-replay', icon: FiPlayCircle, label: 'Trade Replay' },
  { to: '/ai-center', icon: FiCpu, label: 'AI Center' },
  { to: '/themes', icon: FiCompass, label: 'AI Themes' },
  { to: '/docs', icon: FiBookOpen, label: 'Docs' },
  { to: '/notifications', icon: FiInbox, label: 'Notifications', badge: 'unread' },
  { to: '/account', icon: FiUser, label: 'Account' },
];

export default function Sidebar() {
  const navigate = useNavigate();
  // Poll the unread-notifications count every 30s so the badge stays fresh
  // without needing a websocket. Cheap — server just hits a single COUNT(*).
  const [unread, setUnread] = useState(0);
  useEffect(() => {
    let cancelled = false;
    const refresh = () => getUnreadNotificationCount()
      .then((r) => { if (!cancelled) setUnread(r.unreadCount || 0); })
      .catch(() => {});
    refresh();
    const t = setInterval(refresh, 30_000);
    return () => { cancelled = true; clearInterval(t); };
  }, []);

  const handleLogout = async () => {
    // Best-effort server-side revoke; clear the local token regardless so the
    // user can't get stuck on a stale session if the server is unreachable.
    await apiLogout().catch(() => null);
    localStorage.removeItem('token');
    navigate('/login');
  };

  return (
    <aside className="sidebar">
      <div className="sidebar-header">
        <FiCpu size={24} />
        <span>Claude Trading</span>
      </div>
      <nav className="sidebar-nav">
        {links.map(({ to, icon: Icon, label, badge }) => (
          <NavLink key={to} to={to} className={({ isActive }) => `sidebar-link ${isActive ? 'active' : ''}`} end={to === '/'}>
            <Icon size={18} />
            <span>{label}</span>
            {badge === 'unread' && unread > 0 && (
              <span className="sidebar-badge" aria-label={`${unread} unread`}>{unread > 99 ? '99+' : unread}</span>
            )}
          </NavLink>
        ))}
      </nav>
      <button className="sidebar-logout" onClick={handleLogout}>
        <FiLogOut size={18} />
        <span>Logout</span>
      </button>
    </aside>
  );
}
