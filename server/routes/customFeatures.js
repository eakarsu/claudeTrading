// Custom feature endpoints (batch_09 audit suggestions)
import { Router } from 'express';
import { asyncHandler } from '../middleware/async.js';
import { askAI } from '../services/openrouter.js';

const router = Router();

function parseJSON(t) {
  if (!t) return null;
  const c = String(t).replace(/```(?:json)?/gi, '').replace(/```/g, '');
  const m = c.match(/\{[\s\S]*\}/);
  if (!m) return null;
  try { return JSON.parse(m[0]); } catch { return null; }
}

// 1. Predictive equity curve (drawdown, recovery time)
router.post('/equity-curve-forecast', asyncHandler(async (req, res) => {
  const { historical_pnl, strategy_meta } = req.body || {};
  if (!Array.isArray(historical_pnl)) return res.status(400).json({ error: 'historical_pnl array required' });
  const prompt = `Forecast equity curve drawdown/recovery.\nPNL: ${JSON.stringify(historical_pnl.slice(0, 200))}\nSTRATEGY: ${JSON.stringify(strategy_meta || {})}\nReturn JSON {"projected_max_drawdown_pct":0,"projected_recovery_days":0,"calmar_estimate":0,"warnings":[""]}`;
  const ai = await askAI(prompt, '', { userId: req.user?.id });
  res.json({ type: 'equity-curve-forecast', result: parseJSON(ai) || { raw: ai } });
}));

// 2. Strategy correlation analysis
router.post('/strategy-correlation', asyncHandler(async (req, res) => {
  const { strategies, return_series } = req.body || {};
  if (!Array.isArray(strategies)) return res.status(400).json({ error: 'strategies array required' });
  const prompt = `Compute correlation insights across strategies and flag redundancy.\nSTRATEGIES: ${JSON.stringify(strategies)}\nRETURN_SERIES: ${JSON.stringify(return_series || {}).slice(0, 4000)}\nReturn JSON {"pairwise_correlations":[{"a":"","b":"","corr":0}],"redundant_pairs":[["",""]],"diversification_score":0,"recommendation":""}`;
  const ai = await askAI(prompt, '', { userId: req.user?.id });
  res.json({ type: 'strategy-correlation', result: parseJSON(ai) || { raw: ai } });
}));

// 3. Walk-forward analysis automation
router.post('/walk-forward', asyncHandler(async (req, res) => {
  const { strategy_id, train_window_days, test_window_days, total_window_days } = req.body || {};
  if (!strategy_id) return res.status(400).json({ error: 'strategy_id required' });
  const prompt = `Design a walk-forward validation schedule.\nSTRATEGY: ${strategy_id}\nTRAIN_DAYS: ${train_window_days || 252}\nTEST_DAYS: ${test_window_days || 63}\nTOTAL_DAYS: ${total_window_days || 1260}\nReturn JSON {"folds":[{"train_start":"","train_end":"","test_start":"","test_end":""}],"recommended_reoptim_freq_days":0,"caveats":[""]}`;
  const ai = await askAI(prompt, '', { userId: req.user?.id });
  res.json({ type: 'walk-forward', result: parseJSON(ai) || { raw: ai } });
}));

// 4. Trade journal NLP lesson extraction
router.post('/trade-journal-lessons', asyncHandler(async (req, res) => {
  const { entries } = req.body || {};
  if (!Array.isArray(entries)) return res.status(400).json({ error: 'entries array required' });
  const prompt = `Extract recurring lessons / mistakes from these trade-journal notes. Sympathetic tone, no shame.\nENTRIES: ${JSON.stringify(entries.slice(0, 30))}\nReturn JSON {"recurring_themes":[{"theme":"","frequency":0,"example":""}],"strengths":[""],"action_plan":[""]}`;
  const ai = await askAI(prompt, '', { userId: req.user?.id });
  res.json({ type: 'trade-journal-lessons', result: parseJSON(ai) || { raw: ai } });
}));

// 5. Broker integration for live trading
// TODO: configure credentials for ADDITIONAL_BROKER_API_KEY (IBKR/Tradier) beyond Alpaca.
router.post('/broker-readiness', asyncHandler(async (req, res) => {
  const { broker = 'alpaca', strategy_id } = req.body || {};
  const prompt = `Check readiness to push a strategy to ${broker} live trading. Other-broker-API set: ${Boolean(process.env.ADDITIONAL_BROKER_API_KEY)}. JSON only.\nSTRATEGY_ID: ${strategy_id || 'unknown'}\nReturn JSON {"ready":false,"missing":[""],"risk_checks":[""],"approval_owners":[""]}`;
  const ai = await askAI(prompt, '', { userId: req.user?.id });
  res.json({ type: 'broker-readiness', result: parseJSON(ai) || { raw: ai } });
}));

// 6. Real-time strategy monitoring with anomaly alerts
router.post('/realtime-monitor', asyncHandler(async (req, res) => {
  const { strategy_id, last_minute_metrics, baseline } = req.body || {};
  if (!strategy_id) return res.status(400).json({ error: 'strategy_id required' });
  const prompt = `Inspect live strategy telemetry vs baseline and flag anomalies. JSON only.\nSTRATEGY: ${strategy_id}\nMETRICS: ${JSON.stringify(last_minute_metrics || {})}\nBASELINE: ${JSON.stringify(baseline || {})}\nReturn JSON {"anomalies":[{"metric":"","deviation":0,"severity":"low|med|high"}],"recommended_action":"pause|reduce|continue","reason":""}`;
  const ai = await askAI(prompt, '', { userId: req.user?.id });
  res.json({ type: 'realtime-monitor', result: parseJSON(ai) || { raw: ai } });
}));

// 7. Community strategy marketplace with performance filtering
router.post('/marketplace-rank', asyncHandler(async (req, res) => {
  const { strategies_meta, filter } = req.body || {};
  if (!Array.isArray(strategies_meta)) return res.status(400).json({ error: 'strategies_meta array required' });
  const prompt = `Rank community strategies by verified performance and filter criteria. JSON only.\nSTRATEGIES: ${JSON.stringify(strategies_meta.slice(0, 30))}\nFILTER: ${JSON.stringify(filter || {})}\nReturn JSON {"ranked":[{"id":"","sharpe":0,"drawdown":0,"score":0,"why":""}],"top_pick":""}`;
  const ai = await askAI(prompt, '', { userId: req.user?.id });
  res.json({ type: 'marketplace-rank', result: parseJSON(ai) || { raw: ai } });
}));

// 8. Regulatory reporting automation
// TODO: configure credentials for REG_REPORTING_API_KEY (FINRA / CAT).
router.post('/regulatory-report', asyncHandler(async (req, res) => {
  const { period, trade_blotter } = req.body || {};
  if (!period) return res.status(400).json({ error: 'period required' });
  const prompt = `Assemble regulatory reporting items (CAT / FINRA OATS) from blotter. API set: ${Boolean(process.env.REG_REPORTING_API_KEY)}. JSON only.\nPERIOD: ${period}\nBLOTTER: ${JSON.stringify((trade_blotter || []).slice(0, 80))}\nReturn JSON {"summary":{"trades":0,"exceptions":0},"required_reports":[{"name":"","status":"draft|filed|missing"}],"flags":[""]}`;
  const ai = await askAI(prompt, '', { userId: req.user?.id });
  res.json({ type: 'regulatory-report', result: parseJSON(ai) || { raw: ai } });
}));

export default router;
