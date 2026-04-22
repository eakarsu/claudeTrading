import React, { useState } from 'react';
import { FiPlus, FiCpu } from 'react-icons/fi';
import { useMutation } from '@tanstack/react-query';
import * as api from '../api';
import {
  useResourceList,
  useCreateResource,
  useUpdateResource,
  useDeleteResource,
  useAnalyzeItem,
} from '../hooks/useResource';
import DetailModal from './DetailModal';
import AIOutput from './AIOutput';

/**
 * Reusable feature page powered by React Query. The list, create/update/delete,
 * and per-item AI analysis all route through `useResource` hooks so the cache
 * stays coherent across pages and re-mounts are instant from cache.
 */
export default function FeaturePage({ resource, title, fields, cardRender, defaultNew, aiPrompt, chartParams, extraActions, filterBar, filterItems }) {
  const [selected, setSelected] = useState(null);
  const [showNew, setShowNew] = useState(false);
  const [newData, setNewData] = useState(defaultNew || {});

  const { data: items = [], isLoading } = useResourceList(resource);
  const createMut = useCreateResource(resource);
  const updateMut = useUpdateResource(resource);
  const deleteMut = useDeleteResource(resource);
  const analyzeMut = useAnalyzeItem(resource);

  const pageAIMut = useMutation({
    mutationFn: () =>
      api.askFeatureAI(
        resource,
        aiPrompt || `Provide an overview and analysis of all my ${title} data.`,
      ),
  });

  const handleCreate = async () => {
    try {
      await createMut.mutateAsync(newData);
      setShowNew(false);
      setNewData(defaultNew || {});
    } catch (err) {
      alert(err.message);
    }
  };

  const handleEdit = async (id, data) => {
    try {
      await updateMut.mutateAsync({ id, data });
      setSelected(null);
    } catch (err) {
      alert(err.message);
    }
  };

  const handleDelete = async (id) => {
    try {
      await deleteMut.mutateAsync(id);
    } catch (err) {
      alert(err.message);
    }
  };

  const handleAnalyze = (id) => analyzeMut.mutateAsync(id);

  return (
    <div className="feature-page">
      <div className="page-header">
        <h1>{title}</h1>
        <div className="page-actions">
          {extraActions}
          <button className="btn btn-ai" onClick={() => pageAIMut.mutate()} disabled={pageAIMut.isPending}>
            <FiCpu size={16} /> AI Overview
          </button>
          <button className="btn btn-primary" onClick={() => setShowNew(true)}>
            <FiPlus size={16} /> New {title.replace(/s$/, '')}
          </button>
        </div>
      </div>

      <AIOutput
        content={pageAIMut.data?.analysis || (pageAIMut.error ? `Error: ${pageAIMut.error.message}` : null)}
        loading={pageAIMut.isPending}
        model={pageAIMut.data?.model}
        usage={pageAIMut.data?.usage}
      />

      {showNew && (
        <div className="new-item-form">
          <h3>Create New {title.replace(/s$/, '')}</h3>
          <div className="form-grid">
            {fields.map(({ key, label, type }) => (
              <div key={key} className="form-field">
                <label>{label}</label>
                <input
                  type={type === 'number' ? 'number' : 'text'}
                  value={newData[key] ?? ''}
                  onChange={(e) =>
                    setNewData({
                      ...newData,
                      [key]: type === 'number' ? parseFloat(e.target.value) || 0 : e.target.value,
                    })
                  }
                  placeholder={label}
                  step={type === 'number' ? '0.01' : undefined}
                />
              </div>
            ))}
          </div>
          <div className="form-actions">
            <button className="btn btn-primary" onClick={handleCreate} disabled={createMut.isPending}>
              {createMut.isPending ? 'Creating…' : 'Create'}
            </button>
            <button className="btn btn-secondary" onClick={() => setShowNew(false)}>Cancel</button>
          </div>
        </div>
      )}

      {filterBar}

      {isLoading ? (
        <div className="loading-state">Loading...</div>
      ) : (() => {
        // Optional client-side filter (e.g. restrict to a theme's constituents).
        // Applied here rather than in the query so React Query's cache still
        // holds the full list and switching filters is instant.
        const visible = typeof filterItems === 'function' ? filterItems(items) : items;
        if (visible.length === 0) {
          return <div className="empty-state">No items match the current filter.</div>;
        }
        return (
          <div className="card-grid">
            {visible.map((item) => (
              <div key={item.id} className="card" onClick={() => setSelected(item)}>
                {cardRender(item)}
              </div>
            ))}
          </div>
        );
      })()}

      {selected && (
        <DetailModal
          item={selected}
          fields={fields}
          onClose={() => setSelected(null)}
          onEdit={handleEdit}
          onDelete={handleDelete}
          onAnalyze={handleAnalyze}
          chartParams={chartParams}
          resource={resource}
        />
      )}
    </div>
  );
}
