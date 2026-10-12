import React from 'react';

const scenarios = {
  'trade journal nlp lesson extraction': [
    'Review an illustrative journal with three losing breakout trades, two profitable mean reversion trades, and recurring late entries. Identify lessons and missing evidence.',
    'Compare lessons from a sample journal where stop losses were moved twice and position sizing varied across five trades. Separate observations from assumptions.',
    'Brief a trader on an illustrative month of journal notes: strong plan adherence in week one, weaker adherence in week two, and no verified performance data.'
  ],
  'walk forward analysis automation': [
    'Plan a walk forward test for an illustrative daily moving average strategy using rolling training and out of sample windows. Explain leakage checks.',
    'Compare anchored and rolling windows for a sample strategy with 3 years of daily data. Explain parameter stability and data requirements.',
    'Summarize how to review a fictional walk forward study with deteriorating out of sample returns and no transaction cost estimate.'
  ],
  'strategy correlation analysis to avoid redundancy': [
    'Assess overlap between an illustrative momentum strategy and a trend following strategy. Request aligned return series before estimating correlation.',
    'Compare two sample strategies that both trade broad equity ETFs. Explain exposure overlap, regime sensitivity, and missing data.',
    'Brief a portfolio manager on how to identify redundant strategies using return correlation, drawdown overlap, and common positions.'
  ],
  'regulatory reporting automation': [
    'Outline a reviewable workflow for an illustrative monthly trade report. Identify source records, reconciliation steps, and required human signoff.',
    'Compare manual and automated checks for sample order, execution, and account records. Flag missing jurisdiction and reporting obligations.',
    'Prepare an executive overview of a proposed reporting workflow with exception queues, audit trails, and approval gates. Do not claim compliance.'
  ],
  'broker integration for live trading alpaca already partial': [
    'Review a proposed Alpaca paper trading connection. Cover token handling, order validation, duplicate prevention, and rollback without placing orders.',
    'Compare paper and live trading readiness for an illustrative strategy. Identify account permissions, market data, and safety checks still needed.',
    'Brief reviewers on a staged broker integration plan with kill switch, reconciliation, monitoring, and explicit human authorization before live trading.'
  ],
  'community strategy marketplace with performance filtering': [
    'Design filters for an illustrative strategy marketplace using verified backtests, drawdown, sample length, and fee disclosure.',
    'Compare two fictional strategy listings with different time periods and transaction cost assumptions. Explain why rankings may mislead.',
    'Brief moderators on strategy listing review, performance provenance, risk warnings, and removal criteria.'
  ],
  'predictive equity curve drawdown recovery time': [
    'Explain how to estimate recovery time from an illustrative equity curve with a 12% drawdown. Identify uncertainty and missing return history.',
    'Compare historical drawdown duration and scenario based recovery estimates for a fictional portfolio. Do not promise a recovery date.',
    'Brief risk reviewers on recovery time assumptions, regime changes, and stress scenarios for a sample strategy.'
  ],
  'real time strategy monitoring with anomaly alerts': [
    'Plan monitoring for an illustrative strategy with a sudden fill rate drop and elevated slippage. Suggest alert thresholds and review steps.',
    'Compare anomaly detection for sample order rejection, position drift, and stale market data. Identify false positive controls.',
    'Brief operators on alert severity, escalation, audit logging, and a manual pause procedure for a fictional trading system.'
  ],
};

export default function AIPromptPresets({ topic, onFill, disabled }) {
  const examples = scenarios[topic] || [];
  return <div className="ai-preset-bar" aria-label={`${topic} examples`}>
    <strong>Fill example request</strong>
    {examples.map((scenario, index) => <button key={index} type="button" disabled={disabled} onClick={() => onFill(scenario)}>
      {['Scenario review', 'Evidence check', 'Executive briefing'][index]}
    </button>)}
  </div>;
}
