import React, { Suspense, lazy } from 'react';
import { Routes, Route, Navigate, useLocation } from 'react-router-dom';
import Sidebar from './components/Sidebar';
import DemoBanner from './components/DemoBanner';

// Login is eagerly imported because it's on the initial render path for any
// unauthenticated visitor. Every other page is code-split — the initial
// bundle drops from ~1MB to ~150KB and the heavy ones (StrategyLab, chart
// pages) are only downloaded when the user opens them.
import Login from './pages/Login';

import CodexCustomVizFeature from './pages/CodexCustomVizFeature';
import CodexOperationsFeature from './pages/CodexOperationsFeature';

import TimelineView from './pages/TimelineView';

// // === Batch 09 Gaps & Frontend Mounts ===
const PredictiveEquityCurveDrawdownRecoveryTimeCfs = React.lazy(() => import('./pages/Batch09/PredictiveEquityCurveDrawdownRecoveryTimeCfs'));
const StrategyCorrelationAnalysisToAvoidRedundancyCfs = React.lazy(() => import('./pages/Batch09/StrategyCorrelationAnalysisToAvoidRedundancyCfs'));
const WalkForwardAnalysisAutomationCfs = React.lazy(() => import('./pages/Batch09/WalkForwardAnalysisAutomationCfs'));
const TradeJournalNlpLessonExtractionCfs = React.lazy(() => import('./pages/Batch09/TradeJournalNlpLessonExtractionCfs'));
const BrokerIntegrationForLiveTradingAlpacaAlreadyPartialCfs = React.lazy(() => import('./pages/Batch09/BrokerIntegrationForLiveTradingAlpacaAlreadyPartialCfs'));
const RealTimeStrategyMonitoringWithAnomalyAlertsCfs = React.lazy(() => import('./pages/Batch09/RealTimeStrategyMonitoringWithAnomalyAlertsCfs'));
const CommunityStrategyMarketplaceWithPerformanceFilteringCfs = React.lazy(() => import('./pages/Batch09/CommunityStrategyMarketplaceWithPerformanceFilteringCfs'));
const RegulatoryReportingAutomationCfs = React.lazy(() => import('./pages/Batch09/RegulatoryReportingAutomationCfs'));
const AiWalkForwardCurveFittingDetectorGapAi = React.lazy(() => import('./pages/Batch09/AiWalkForwardCurveFittingDetectorGapAi'));
const AiTradeJournalLessonExtractorGapAi = React.lazy(() => import('./pages/Batch09/AiTradeJournalLessonExtractorGapAi'));
const AiPortfolioRiskAttributionBeyondReportGenerationGapAi = React.lazy(() => import('./pages/Batch09/AiPortfolioRiskAttributionBeyondReportGenerationGapAi'));
const TaxLotWashSaleTrackingGapNon = React.lazy(() => import('./pages/Batch09/TaxLotWashSaleTrackingGapNon'));
const RegulatoryComplianceFinraMifidReportingGapNon = React.lazy(() => import('./pages/Batch09/RegulatoryComplianceFinraMifidReportingGapNon'));
const MultiAccountAllocationPmmStyleGapNon = React.lazy(() => import('./pages/Batch09/MultiAccountAllocationPmmStyleGapNon'));
const StrategyMarketplaceWithMonetizationGapNon = React.lazy(() => import('./pages/Batch09/StrategyMarketplaceWithMonetizationGapNon'));
const KycamlWorkflowForPaidUsersGapNon = React.lazy(() => import('./pages/Batch09/KycamlWorkflowForPaidUsersGapNon'));

const Dashboard         = lazy(() => import('./pages/Dashboard'));
const TrailingStops     = lazy(() => import('./pages/TrailingStops'));
const CopyTrades        = lazy(() => import('./pages/CopyTrades'));
const WheelStrategies   = lazy(() => import('./pages/WheelStrategies'));
const Watchlist         = lazy(() => import('./pages/Watchlist'));
const TradeJournalPage  = lazy(() => import('./pages/TradeJournal'));
const PriceAlerts       = lazy(() => import('./pages/PriceAlerts'));
const TradeSignals      = lazy(() => import('./pages/TradeSignals'));
const StockScreener     = lazy(() => import('./pages/StockScreener'));
const RiskAssessments   = lazy(() => import('./pages/RiskAssessments'));
const Portfolio         = lazy(() => import('./pages/Portfolio'));
const SentimentPage     = lazy(() => import('./pages/Sentiment'));
const OptionsChainPage  = lazy(() => import('./pages/OptionsChain'));
const MarketNewsPage    = lazy(() => import('./pages/MarketNews'));
const AICenter          = lazy(() => import('./pages/AICenter'));
const AlpacaTrading     = lazy(() => import('./pages/AlpacaTrading'));
const BrokerGovernance  = lazy(() => import('./pages/BrokerGovernance'));
const SignalCharts      = lazy(() => import('./pages/SignalCharts'));
const StrategyLab       = lazy(() => import('./pages/StrategyLab'));
const EventCalendarPage = lazy(() => import('./pages/EventCalendar'));
const AuditLogPage      = lazy(() => import('./pages/AuditLog'));
const AccountSettings   = lazy(() => import('./pages/AccountSettings'));
const TradeReplay       = lazy(() => import('./pages/TradeReplay'));
const NotificationsPage = lazy(() => import('./pages/Notifications'));
const ThemesPage        = lazy(() => import('./pages/Themes'));
const DocsPage          = lazy(() => import('./pages/Docs'));
const WebhooksPage      = lazy(() => import('./pages/Webhooks'));
const HyperoptPage      = lazy(() => import('./pages/Hyperopt'));
const StrategyAuditPage = lazy(() => import('./pages/StrategyAudit'));
const ProtectionsPage   = lazy(() => import('./pages/Protections'));
const EdgePage          = lazy(() => import('./pages/Edge'));
const SavedBacktestsPage = lazy(() => import('./pages/SavedBacktests'));
const StrategyMigratorPage = lazy(() => import('./pages/StrategyMigrator'));
const FreqaiModelsPage  = lazy(() => import('./pages/FreqaiModels'));
const ExchangesPage     = lazy(() => import('./pages/Exchanges'));
const PlotsPage         = lazy(() => import('./pages/Plots'));
const ProducerConsumerPage = lazy(() => import('./pages/ProducerConsumer'));
const FreqtradeApiPage  = lazy(() => import('./pages/FreqtradeApi'));
const StrategyEditorPage = lazy(() => import('./pages/StrategyEditor'));
const LeveragePage = lazy(() => import('./pages/Leverage'));
const BacktestAnalysisPage = lazy(() => import('./pages/BacktestAnalysis'));
const UtilitiesPage = lazy(() => import('./pages/Utilities'));
const HyperoptAdvancedPage = lazy(() => import('./pages/HyperoptAdvanced'));
const OrderflowPage = lazy(() => import('./pages/Orderflow'));
const RlLitePage = lazy(() => import('./pages/RlLite'));
const FreqaiSidecarPage = lazy(() => import('./pages/FreqaiSidecar'));
const StrategyAbPage    = lazy(() => import('./pages/StrategyAb'));
const SlippageAttributionPage = lazy(() => import('./pages/SlippageAttribution'));

function ProtectedRoute({ children }) {
  const token = localStorage.getItem('token');
  return token ? children : <Navigate to="/login" />;
}

function PageFallback() {
  return <div style={{ padding: 24, color: '#888' }}>Loading…</div>;
}

export default function App() {
  const location = useLocation();
  const isLogin = location.pathname === '/login';

  return (
    <div className="app-layout">
      {!isLogin && <Sidebar />}
      <main className={isLogin ? 'main-full' : 'main-content'}>
        {!isLogin && <DemoBanner />}
        <Suspense fallback={<PageFallback />}>
          <Routes>
        <Route path="/insights/timeline" element={<ProtectedRoute><TimelineView /></ProtectedRoute>} />
        <Route path="/codex/custom-viz" element={<ProtectedRoute><CodexCustomVizFeature /></ProtectedRoute>} />
        <Route path="/codex/operations" element={<ProtectedRoute><CodexOperationsFeature /></ProtectedRoute>} />

            <Route path="/login" element={<Login />} />
            <Route path="/" element={<ProtectedRoute><Dashboard /></ProtectedRoute>} />
            <Route path="/trailing-stops" element={<ProtectedRoute><TrailingStops /></ProtectedRoute>} />
            <Route path="/copy-trades" element={<ProtectedRoute><CopyTrades /></ProtectedRoute>} />
            <Route path="/wheel-strategies" element={<ProtectedRoute><WheelStrategies /></ProtectedRoute>} />
            <Route path="/watchlist" element={<ProtectedRoute><Watchlist /></ProtectedRoute>} />
            <Route path="/trade-journal" element={<ProtectedRoute><TradeJournalPage /></ProtectedRoute>} />
            <Route path="/price-alerts" element={<ProtectedRoute><PriceAlerts /></ProtectedRoute>} />
            <Route path="/trade-signals" element={<ProtectedRoute><TradeSignals /></ProtectedRoute>} />
            <Route path="/stock-screener" element={<ProtectedRoute><StockScreener /></ProtectedRoute>} />
            <Route path="/risk-assessments" element={<ProtectedRoute><RiskAssessments /></ProtectedRoute>} />
            <Route path="/portfolio" element={<ProtectedRoute><Portfolio /></ProtectedRoute>} />
            <Route path="/sentiment" element={<ProtectedRoute><SentimentPage /></ProtectedRoute>} />
            <Route path="/options-chain" element={<ProtectedRoute><OptionsChainPage /></ProtectedRoute>} />
            <Route path="/market-news" element={<ProtectedRoute><MarketNewsPage /></ProtectedRoute>} />
            <Route path="/signal-charts" element={<ProtectedRoute><SignalCharts /></ProtectedRoute>} />
            <Route path="/alpaca-trading" element={<ProtectedRoute><AlpacaTrading /></ProtectedRoute>} />
            <Route path="/broker-governance" element={<ProtectedRoute><BrokerGovernance /></ProtectedRoute>} />
            {/* Legacy alias — notifications emitted by autoTrader.js/seed.js
                point at `/auto-trader`. Redirect so old rows still resolve
                to the real page (AlpacaTrading houses the auto-trader UI). */}
            <Route path="/auto-trader" element={<Navigate to="/alpaca-trading" replace />} />
            <Route path="/strategy-lab" element={<ProtectedRoute><StrategyLab /></ProtectedRoute>} />
            <Route path="/ai-center" element={<ProtectedRoute><AICenter /></ProtectedRoute>} />
            <Route path="/event-calendar" element={<ProtectedRoute><EventCalendarPage /></ProtectedRoute>} />
            <Route path="/audit-log" element={<ProtectedRoute><AuditLogPage /></ProtectedRoute>} />
            <Route path="/account" element={<ProtectedRoute><AccountSettings /></ProtectedRoute>} />
            <Route path="/trade-replay" element={<ProtectedRoute><TradeReplay /></ProtectedRoute>} />
            <Route path="/notifications" element={<ProtectedRoute><NotificationsPage /></ProtectedRoute>} />
            <Route path="/themes" element={<ProtectedRoute><ThemesPage /></ProtectedRoute>} />
            <Route path="/docs" element={<ProtectedRoute><DocsPage /></ProtectedRoute>} />
            <Route path="/webhooks" element={<ProtectedRoute><WebhooksPage /></ProtectedRoute>} />
            <Route path="/hyperopt" element={<ProtectedRoute><HyperoptPage /></ProtectedRoute>} />
            <Route path="/strategy-audit" element={<ProtectedRoute><StrategyAuditPage /></ProtectedRoute>} />
            <Route path="/protections" element={<ProtectedRoute><ProtectionsPage /></ProtectedRoute>} />
            <Route path="/edge" element={<ProtectedRoute><EdgePage /></ProtectedRoute>} />
            <Route path="/saved-backtests" element={<ProtectedRoute><SavedBacktestsPage /></ProtectedRoute>} />
            <Route path="/strategy-migrator" element={<ProtectedRoute><StrategyMigratorPage /></ProtectedRoute>} />
            <Route path="/freqai-models" element={<ProtectedRoute><FreqaiModelsPage /></ProtectedRoute>} />
            <Route path="/exchanges" element={<ProtectedRoute><ExchangesPage /></ProtectedRoute>} />
            <Route path="/plots" element={<ProtectedRoute><PlotsPage /></ProtectedRoute>} />
            <Route path="/producer-consumer" element={<ProtectedRoute><ProducerConsumerPage /></ProtectedRoute>} />
            <Route path="/freqtrade-api" element={<ProtectedRoute><FreqtradeApiPage /></ProtectedRoute>} />
            <Route path="/strategy-editor" element={<ProtectedRoute><StrategyEditorPage /></ProtectedRoute>} />
            <Route path="/leverage" element={<ProtectedRoute><LeveragePage /></ProtectedRoute>} />
            <Route path="/backtest-analysis" element={<ProtectedRoute><BacktestAnalysisPage /></ProtectedRoute>} />
            <Route path="/utilities" element={<ProtectedRoute><UtilitiesPage /></ProtectedRoute>} />
            <Route path="/hyperopt-advanced" element={<ProtectedRoute><HyperoptAdvancedPage /></ProtectedRoute>} />
            <Route path="/orderflow" element={<ProtectedRoute><OrderflowPage /></ProtectedRoute>} />
            <Route path="/rl-lite" element={<ProtectedRoute><RlLitePage /></ProtectedRoute>} />
            <Route path="/freqai-sidecar" element={<ProtectedRoute><FreqaiSidecarPage /></ProtectedRoute>} />
            <Route path="/strategy-ab" element={<ProtectedRoute><StrategyAbPage /></ProtectedRoute>} />
            <Route path="/slippage-attribution" element={<ProtectedRoute><SlippageAttributionPage /></ProtectedRoute>} />
          
      {/* // === Batch 09 Gaps & Frontend Mounts === */}
        <Route path="/batch09/cfs/predictive-equity-curve-drawdown-recovery-time" element={<React.Suspense fallback={<div>Loading...</div>}><PredictiveEquityCurveDrawdownRecoveryTimeCfs /></React.Suspense>} />
        <Route path="/batch09/cfs/strategy-correlation-analysis-to-avoid-redundancy" element={<React.Suspense fallback={<div>Loading...</div>}><StrategyCorrelationAnalysisToAvoidRedundancyCfs /></React.Suspense>} />
        <Route path="/batch09/cfs/walk-forward-analysis-automation" element={<React.Suspense fallback={<div>Loading...</div>}><WalkForwardAnalysisAutomationCfs /></React.Suspense>} />
        <Route path="/batch09/cfs/trade-journal-nlp-lesson-extraction" element={<React.Suspense fallback={<div>Loading...</div>}><TradeJournalNlpLessonExtractionCfs /></React.Suspense>} />
        <Route path="/batch09/cfs/broker-integration-for-live-trading-alpaca-already-partial" element={<React.Suspense fallback={<div>Loading...</div>}><BrokerIntegrationForLiveTradingAlpacaAlreadyPartialCfs /></React.Suspense>} />
        <Route path="/batch09/cfs/real-time-strategy-monitoring-with-anomaly-alerts" element={<React.Suspense fallback={<div>Loading...</div>}><RealTimeStrategyMonitoringWithAnomalyAlertsCfs /></React.Suspense>} />
        <Route path="/batch09/cfs/community-strategy-marketplace-with-performance-filtering" element={<React.Suspense fallback={<div>Loading...</div>}><CommunityStrategyMarketplaceWithPerformanceFilteringCfs /></React.Suspense>} />
        <Route path="/batch09/cfs/regulatory-reporting-automation" element={<React.Suspense fallback={<div>Loading...</div>}><RegulatoryReportingAutomationCfs /></React.Suspense>} />
        <Route path="/batch09/gap-ai/ai-walk-forward-curve-fitting-detector" element={<React.Suspense fallback={<div>Loading...</div>}><AiWalkForwardCurveFittingDetectorGapAi /></React.Suspense>} />
        <Route path="/batch09/gap-ai/ai-trade-journal-lesson-extractor" element={<React.Suspense fallback={<div>Loading...</div>}><AiTradeJournalLessonExtractorGapAi /></React.Suspense>} />
        <Route path="/batch09/gap-ai/ai-portfolio-risk-attribution-beyond-report-generation" element={<React.Suspense fallback={<div>Loading...</div>}><AiPortfolioRiskAttributionBeyondReportGenerationGapAi /></React.Suspense>} />
        <Route path="/batch09/gap-nonai/tax-lot-wash-sale-tracking" element={<React.Suspense fallback={<div>Loading...</div>}><TaxLotWashSaleTrackingGapNon /></React.Suspense>} />
        <Route path="/batch09/gap-nonai/regulatory-compliance-finra-mifid-reporting" element={<React.Suspense fallback={<div>Loading...</div>}><RegulatoryComplianceFinraMifidReportingGapNon /></React.Suspense>} />
        <Route path="/batch09/gap-nonai/multi-account-allocation-pmm-style" element={<React.Suspense fallback={<div>Loading...</div>}><MultiAccountAllocationPmmStyleGapNon /></React.Suspense>} />
        <Route path="/batch09/gap-nonai/strategy-marketplace-with-monetization" element={<React.Suspense fallback={<div>Loading...</div>}><StrategyMarketplaceWithMonetizationGapNon /></React.Suspense>} />
        <Route path="/batch09/gap-nonai/kycaml-workflow-for-paid-users" element={<React.Suspense fallback={<div>Loading...</div>}><KycamlWorkflowForPaidUsersGapNon /></React.Suspense>} />

      </Routes>
        </Suspense>
      </main>
    </div>
  );
}
