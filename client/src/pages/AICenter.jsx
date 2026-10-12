import NativeAIControls from "../components/NativeAIControls.jsx";
import React, { useState } from 'react';
import { FiCpu, FiSend, FiTrendingUp, FiBriefcase, FiZap, FiShield, FiLayers, FiCopy } from 'react-icons/fi';
import * as api from '../api';
import FormattedAIReport from '../components/FormattedAIReport';

const aiTools = [
  { id: 'market', icon: FiTrendingUp, label: 'Market Summary', desc: 'Get AI overview of current market conditions', action: api.aiMarketSummary },
  { id: 'portfolio', icon: FiBriefcase, label: 'Portfolio Review', desc: 'AI analysis of your entire portfolio', action: api.aiPortfolioReview },
  { id: 'trade', icon: FiZap, label: 'Trade Idea', desc: 'Generate AI trade idea with entry/exit/stop', action: api.aiTradeIdea },
  { id: 'risk', icon: FiShield, label: 'Risk Report', desc: 'Comprehensive risk analysis across positions', action: api.aiRiskReport },
  { id: 'options', icon: FiLayers, label: 'Options Strategy', desc: 'AI-suggested options strategies', action: null },
  { id: 'politician', icon: FiCopy, label: 'Politician Analysis', desc: 'Analyze politician trading patterns', action: api.aiPoliticianAnalysis },
];

export default function AICenter() {
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [activeTool, setActiveTool] = useState('');
  const [chatInput, setChatInput] = useState('');
  const [optionsSymbol, setOptionsSymbol] = useState('TSLA');
  const examples = [
    { name: 'Market outlook', question: 'Compare a cautious, balanced, and bullish plan for a diversified US equity portfolio. Explain the evidence to check before trading.', symbol: 'SPY' },
    { name: 'Portfolio review', question: 'Review concentration, drawdown risk, and diversification for an illustrative portfolio with 50% broad equities, 30% bonds, and 20% cash. State assumptions.', symbol: 'QQQ' },
    { name: 'Options planning', question: 'Explain the risks, breakeven, and exit plan for an illustrative defined risk options strategy. Do not assume a live quote or place a trade.', symbol: 'AAPL' },
  ];

  const runTool = async (tool) => {
    setLoading(true);
    setActiveTool(tool.id);
    setResult(null);
    setError('');
    try {
      let res;
      if (tool.id === 'options') {
        res = await api.aiOptionsStrategy(optionsSymbol);
      } else {
        res = await tool.action();
      }
      setResult(res);
    } catch (err) {
      setError(`AI analysis is unavailable: ${err.message}`);
    }
    setLoading(false);
  };

  const handleChat = async (e) => {
    e.preventDefault();
    if (!chatInput.trim()) return;
    setLoading(true);
    setActiveTool('chat');
    setResult(null);
    setError('');
    try {
      const res = await api.aiChat(chatInput, 'general trading');
      setResult(res);
    } catch (err) {
      setError(`AI analysis is unavailable: ${err.message}`);
    }
    setLoading(false);
    setChatInput('');
  };

  return (
    <NativeAIControls busy={loading} context="claudeTrading" presets={examples.map((example) => ({ name: example.name, fill: () => {
      setChatInput(example.question);
      setOptionsSymbol(example.symbol);
      return { filled: 2, manual: [] };
    } }))}><div className="feature-page">
      <div className="page-header">
        <h1><FiCpu /> AI Center</h1>
      </div>

      <div className="ai-chat-box">
        <form onSubmit={handleChat} className="ai-chat-form">
          <input data-ai-field={"chatInput"}
            type="text"
            value={chatInput}
            onChange={(e) => setChatInput(e.target.value)}
            placeholder="Ask AI anything about trading, markets, strategies..."
            className="ai-chat-input"
          />
          <button type="submit" className="btn btn-primary" disabled={loading}>
            <FiSend size={18} />
          </button>
        </form>
      </div>

      <h2 className="section-title">AI Tools</h2>
      <div className="card-grid ai-tools-grid">
        {aiTools.map((tool) => (
          <div
            key={tool.id}
            className={`card ai-tool-card ${activeTool === tool.id ? 'active' : ''}`}
            onClick={() => tool.id !== 'options' && runTool(tool)}
          >
            <div className="card-icon" style={{ background: '#e11d48' }}>
              <tool.icon size={24} color="#fff" />
            </div>
            <h3>{tool.label}</h3>
            <p>{tool.desc}</p>
            {tool.id === 'options' && (
              <div className="options-input" onClick={(e) => e.stopPropagation()}>
                <input data-ai-field={"optionsSymbol"}
                  type="text"
                  value={optionsSymbol}
                  onChange={(e) => setOptionsSymbol(e.target.value.toUpperCase())}
                  placeholder="Symbol"
                  className="inline-input"
                />
                <button className="btn btn-sm btn-primary" onClick={() => runTool(tool)}>
                  Analyze
                </button>
              </div>
            )}
          </div>
        ))}
      </div>

      <FormattedAIReport
        response={result}
        error={error}
        loading={loading}
        model={result?.model}
        tokens={result?.usage}
      />
    </div></NativeAIControls>
  );
}
