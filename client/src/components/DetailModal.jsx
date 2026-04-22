import React, { useState } from 'react';
import { FiX, FiEdit2, FiTrash2, FiCpu, FiExternalLink } from 'react-icons/fi';
import AIOutput from './AIOutput';
import TradingChart from './TradingChart';

// Detect http(s) URLs so we can render them as real links instead of
// uncopyable plain text. Used both for explicit `url` fields (Market News,
// Trade Signals) and for any string value that happens to be a URL.
function parseSafeUrl(value) {
  if (!value || typeof value !== 'string') return null;
  try {
    const u = new URL(value);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    return u;
  } catch {
    return null;
  }
}

export default function DetailModal({ item, fields, onClose, onEdit, onDelete, onAnalyze, chartParams, resource }) {
  const [aiResult, setAiResult] = useState(null);
  const [aiLoading, setAiLoading] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editData, setEditData] = useState({ ...item });

  if (!item) return null;

  const handleAnalyze = async () => {
    setAiLoading(true);
    setAiResult(null);
    try {
      const result = await onAnalyze(item.id);
      setAiResult(result);
    } catch (err) {
      setAiResult({ analysis: `Error: ${err.message}` });
    }
    setAiLoading(false);
  };

  const handleSave = () => {
    onEdit(item.id, editData);
    setEditing(false);
  };

  // Build chart params from item data
  const symbol = item.symbol;
  const resolvedChartParams = chartParams
    ? (typeof chartParams === 'function' ? chartParams(item) : chartParams)
    : null;

  // Surface an "Open article ↗" button in the header when the row has a
  // URL. Works for any resource that carries a `url` column (Market News
  // today; Trade Signals / webhooks can add one later).
  const articleUrl = parseSafeUrl(item.url);

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal modal-wide" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>{item.symbol || item.title || 'Details'}</h2>
          <div className="modal-actions">
            {articleUrl && (
              <a
                className="btn btn-secondary"
                href={articleUrl.href}
                target="_blank"
                rel="noopener noreferrer"
              >
                <FiExternalLink size={16} /> Open article
              </a>
            )}
            <button className="btn btn-ai" onClick={handleAnalyze} disabled={aiLoading}>
              <FiCpu size={16} /> AI Analyze
            </button>
            <button className="btn btn-edit" onClick={() => setEditing(!editing)}>
              <FiEdit2 size={16} /> {editing ? 'Cancel' : 'Edit'}
            </button>
            <button className="btn btn-delete" onClick={() => { onDelete(item.id); onClose(); }}>
              <FiTrash2 size={16} /> Delete
            </button>
            <button className="btn btn-close" onClick={onClose}>
              <FiX size={18} />
            </button>
          </div>
        </div>

        <div className="modal-body">
          {/* Chart */}
          {symbol && resolvedChartParams && (
            <TradingChart
              symbol={symbol}
              params={resolvedChartParams}
              height={300}
              chartKey={`${resource}-${symbol}-${item.id}`}
              resource={resource}
            />
          )}

          <div className="detail-grid">
            {fields.map(({ key, label, type }) => {
              const value = item[key];
              const parsed = parseSafeUrl(value);
              return (
                <div key={key} className="detail-field">
                  <label>{label}</label>
                  {editing ? (
                    <input
                      type={type === 'number' ? 'number' : 'text'}
                      value={editData[key] ?? ''}
                      onChange={(e) => setEditData({ ...editData, [key]: type === 'number' ? parseFloat(e.target.value) || 0 : e.target.value })}
                      step={type === 'number' ? '0.01' : undefined}
                    />
                  ) : parsed ? (
                    <a
                      href={parsed.href}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="detail-value detail-link"
                    >
                      {value} <FiExternalLink size={12} />
                    </a>
                  ) : (
                    <span className="detail-value">
                      {type === 'number' && typeof value === 'number'
                        ? value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
                        : (value ?? '—')}
                    </span>
                  )}
                </div>
              );
            })}
          </div>

          {editing && (
            <div className="modal-edit-actions">
              <button className="btn btn-primary" onClick={handleSave}>Save Changes</button>
            </div>
          )}

          {item.aiAnalysis && !aiResult && (
            <AIOutput content={item.aiAnalysis} />
          )}

          <AIOutput
            content={aiResult?.analysis}
            loading={aiLoading}
            model={aiResult?.model}
            usage={aiResult?.usage}
          />
        </div>
      </div>
    </div>
  );
}
