import React from 'react';
import ReactMarkdown from 'react-markdown';
import { FiCpu, FiLoader } from 'react-icons/fi';

export default function AIOutput({ content, loading, model, usage }) {
  if (loading) {
    return (
      <div className="ai-output loading">
        <div className="ai-output-header">
          <FiLoader className="spin" size={18} />
          <span>AI is analyzing...</span>
        </div>
        <div className="ai-shimmer">
          <div className="shimmer-line" style={{ width: '90%' }} />
          <div className="shimmer-line" style={{ width: '75%' }} />
          <div className="shimmer-line" style={{ width: '85%' }} />
          <div className="shimmer-line" style={{ width: '60%' }} />
        </div>
      </div>
    );
  }

  if (!content) return null;

  return (
    <div className="ai-output">
      <div className="ai-output-header">
        <FiCpu size={18} />
        <span>AI Analysis</span>
        {model && <span className="ai-model-badge">{model.split('/').pop()}</span>}
      </div>
      <div className="ai-output-body">
        <ReactMarkdown>{content}</ReactMarkdown>
      </div>
      {usage && (
        <div className="ai-output-footer">
          <span>Tokens: {usage.prompt_tokens + usage.completion_tokens}</span>
        </div>
      )}
    </div>
  );
}
