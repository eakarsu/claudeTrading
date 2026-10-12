import React, { useState } from 'react';
import Modal from './AIWorkspaceModal';
import AIWorkspace from './AIWorkspace';
import features from './aiWorkspaceFeatures.json';
import './AIWorkspace.css';

export default function AIReportLibrary({ floating = false, compact = false }) {
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState(null);
  const [search, setSearch] = useState('');
  const close = () => { setOpen(false); setSelected(null); };
  const visible = features.filter((feature) => `${feature.title} ${feature.description}`.toLowerCase().includes(search.toLowerCase()));
  return <>
    <button type="button" className={`ai-library-launcher ${floating ? 'ai-library-launcher-floating' : ''} ${compact ? 'ai-library-launcher-compact' : ''}`} onClick={() => setOpen(true)}><span aria-hidden="true">✦</span> AI reports <small>{features.length}</small></button>
    {open && <Modal title={selected ? selected.title : 'AI reports'} className="ai-workspace-dialog" onClose={close} footer={<>{selected && <button type="button" className="btn btn-secondary" onClick={() => setSelected(null)}>All AI features</button>}<button type="button" className="btn btn-secondary" onClick={close}>Cancel</button></>}>
      {selected ? <AIWorkspace key={selected.id} feature={selected} /> : <section className="ai-library"><p className="ai-muted">Choose a feature, fill all fields with an example, then generate a professional OpenRouter report. Reports provide recommendations for your review.</p><label htmlFor="ai-library-search">Find an AI feature</label><input id="ai-library-search" type="search" value={search} placeholder="Search all AI reports…" onChange={(event) => setSearch(event.target.value)} /><div className="ai-library-grid">{visible.map((feature) => <button key={feature.id} className="ai-library-feature" type="button" onClick={() => setSelected(feature)}><strong>{feature.title.replace(/^no\s+/i, '')}</strong><span>Advisory report · 3 complete examples</span><span>Open workspace →</span></button>)}</div>{!visible.length && <p className="ai-muted">No matching features. Try a different search.</p>}</section>}
    </Modal>}
  </>;
}
