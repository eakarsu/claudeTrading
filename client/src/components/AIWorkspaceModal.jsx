import React, { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
const dialogs = [];
let originalOverflow = '';

export default function AIWorkspaceModal({ title, children, onClose, footer, className = '' }) {
  const dialog = useRef(null);
  const marker = useRef({});
  const close = useRef(onClose); close.current = onClose;
  useEffect(() => {
    const previous = document.activeElement;
    if (!dialogs.length) { originalOverflow = document.body.style.overflow; document.body.style.overflow = 'hidden'; }
    const current = marker.current; dialogs.push(current);
    dialog.current?.querySelector('button, input, textarea, select, [tabindex="0"]')?.focus();
    const onKey = (event) => {
      if (dialogs.at(-1) !== current) return;
      if (event.key === 'Escape') { event.preventDefault(); close.current(); }
      if (event.key === 'Tab') {
        const controls = [...(dialog.current?.querySelectorAll('button:not(:disabled), input:not(:disabled), textarea:not(:disabled), select:not(:disabled), a[href], [tabindex="0"]') || [])];
        const first = controls[0], last = controls.at(-1);
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
        if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
      }
    };
    document.addEventListener('keydown', onKey);
    return () => { dialogs.splice(dialogs.indexOf(current), 1); if (!dialogs.length) document.body.style.overflow = originalOverflow; document.removeEventListener('keydown', onKey); previous?.focus?.(); };
  }, []);
  return createPortal(<div className="ai-workspace-modal-overlay" onClick={onClose}><div className={`ai-workspace-modal ${className}`} role="dialog" aria-modal="true" aria-label={title} ref={dialog} onClick={(event) => event.stopPropagation()}><header className="ai-workspace-modal-header"><h2>{title}</h2><button type="button" aria-label="Cancel" onClick={onClose}>×</button></header><div className="ai-workspace-modal-body">{children}</div>{footer && <footer className="ai-workspace-modal-footer">{footer}</footer>}</div></div>, document.body);
}
