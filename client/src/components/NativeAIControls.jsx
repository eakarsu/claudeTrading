import React, { useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import './NativeAIControls.css';

const variants = ['Quick brief', 'Team planning', 'Detailed review'];
const referenceKey = (key) => /(?:^|_)(?:id|ids)(?:_|$)/i.test(key) || /[a-z](?:Id|Ids)(?:[A-Z]\w*|$)/.test(key) || /^(?:selected)?(?:patient|device|menu|item|case|memory|batch|document|client|plot|field|unit|building|ride|zone|restaurant|vin|serial_number|license_number)$/i.test(key);
const evidenceKey = (key) => String(key || '').replace(/([A-Z])([A-Z][a-z])/g, '$1_$2').replace(/([a-z0-9])([A-Z])/g, '$1_$2').toLowerCase().split(/[^a-z0-9]+/).some(token => ['image', 'images', 'photo', 'photos', 'audio', 'video', 'file', 'files', 'filename', 'filepath', 'upload', 'uploads', 'uploaded', 'url', 'urls', 'uri', 'uris', 'transcript', 'transcripts', 'recording', 'recordings', 'attachment', 'attachments'].includes(token));
const human = (key) => String(key || '').replace(/([a-z])([A-Z])/g, '$1 $2').replace(/[_-]+/g, ' ');
const json = (value) => { try { return JSON.parse(value); } catch { return undefined; } };

function labelFor(element) {
  const label = Array.from(element.labels || []).map((item) => item.textContent.trim()).join(' ');
  let preceding = element.previousElementSibling;
  while (preceding && !['LABEL', 'INPUT', 'TEXTAREA', 'SELECT'].includes(preceding.tagName)) preceding = preceding.previousElementSibling;
  return label || element.closest('label')?.textContent.trim() || (preceding?.tagName === 'LABEL' ? preceding.textContent.trim() : '') || element.parentElement?.querySelector('label')?.textContent.trim() || element.placeholder || human(element.dataset.aiField || element.name || element.id);
}

function numeric(element, key, variant) {
  const hint = Number(element.placeholder);
  const values = /(?:vehicle|model|manufactur).*year|^year$/i.test(key) ? [new Date().getFullYear() - 2, new Date().getFullYear() - 1, new Date().getFullYear()] : /year/i.test(key) ? [3, 5, 10] : /day|window|horizon|lookback/i.test(key) ? [30, 60, 90]
    : /hour/i.test(key) ? [8, 12, 16] : /percent|percentage|risk|threshold/i.test(key) ? [15, 25, 40]
      : /budget|balance|cost|price|contribution|revenue/i.test(key) ? [100, 250, 500]
        : /count|num|limit|quantity|sample/i.test(key) ? [10, 25, 50] : [1, 3, 5];
  let value = Number.isFinite(hint) && element.placeholder.trim() ? hint * [1, 1.25, 1.5][variant] : values[variant];
  const minimum = element.min !== '' ? Number(element.min) : -Infinity;
  const maximum = element.max !== '' ? Number(element.max) : Infinity;
  value = Math.max(minimum, Math.min(maximum, value));
  const step = element.step && element.step !== 'any' ? Number(element.step) : 1;
  if (Number.isFinite(step) && step > 0) value = Math.round(value / step) * step;
  return String(Math.max(minimum, Math.min(maximum, value)));
}

function textExample(element, key, label, variant, context) {
  const existing = element.value.trim(), placeholder = (element.placeholder || '').trim();
  const explicit = element.dataset.aiExample;
  if (explicit !== undefined) return explicit;
  const source = json(placeholder) ?? json(existing);
  // Reuse the native schema rather than guessing a new data contract.
  if (source !== undefined) return JSON.stringify(source, null, 2);
  const textAllowed = /(?:JSON|telemetry).*\bor\s+(?:(?:freeform|free|full)\s+)?(?:notes|text|list|description)|\b(?:text|notes|description)\s+or\s+(?:full\s+)?JSON/i.test(label);
  if (!textAllowed && (/json|geojson|payload/i.test(key + ' ' + label) || /readings|telemetry|polygon|components|boundaries|qc_data|source_data/i.test(key))) {
    if (existing) return existing;
    return null;
  }
  const mode = ['a concise first review', 'a team planning review', 'a detailed review with assumptions and alternatives'][variant];
  if (/goal|objective|purpose|need/i.test(key)) return ['Identify the highest priority next steps and explain the evidence.', 'Prepare a practical plan with responsibilities, timing and success measures.', 'Compare feasible options, identify uncertainties and recommend a reviewable action plan.'][variant];
  if (/tone|style/i.test(key)) return ['Clear and concise', 'Professional and collaborative', 'Detailed and evidence based'][variant];
  if (/format/i.test(key)) return ['Executive summary and action list', 'Summary, recommendations and implementation table', 'Detailed report with assumptions, risks and next steps'][variant];
  if (/audience|recipient/i.test(key)) return ['Project owner', 'Operations team', 'Leadership and subject matter reviewers'][variant];
  if (/completed/i.test(key)) return 'Account setup, orientation, initial training';
  if (/outstanding/i.test(key)) return 'Policy acknowledgment, access review, final approval';
  if (/domain/i.test(key)) return existing || 'hr_onboarding, security_training, code_of_conduct';
  if (/policy/i.test(key)) return 'Example policy: verify required training and approvals, document exceptions, and require an authorized reviewer before any operational change.';
  if (/soil/i.test(key)) return ['Illustrative soil sample: pH 5.4, organic matter 2.1%, clay loam; no verified field observations supplied.', 'Illustrative soil sample: pH 6.2, organic matter 2.8%, sandy loam; confirm with current laboratory results.', 'Illustrative soil sample: pH 7.1, organic matter 3.4%, loam; include assumptions and measurement limitations.'][variant];
  if (/crop/i.test(key)) return ['Maize', 'Wheat', 'Soybeans'][variant];
  if (/region|location|site/i.test(key)) return ['Example northern region', 'Example central region', 'Example southern region'][variant];
  if (/disease/i.test(key)) return ['Influenza', 'Seasonal respiratory illness', 'Seasonal allergy symptoms'][variant];
  if (/priority/i.test(key)) return ['Accessibility and safety', 'Balanced service and cost', 'Resilience and long term value'][variant];
  if (/category/i.test(key)) return ['General operations', 'Planning and improvement', 'Risk and quality review'][variant];
  if (/product.*name|listing.*title|title/i.test(key)) return ['Example service offering', 'Example product launch', 'Example operations review'][variant];
  if (/weather/i.test(key)) return 'Illustrative forecast: moderate temperatures, intermittent rain and possible high winds. Confirm against the current local forecast.';
  if (/chief.*complaint|symptoms|exam.*findings|medical.*history|patient.*history/i.test(key)) return `Illustrative clinical brief for review: intermittent blurred vision after close work, no confirmed examination findings supplied. Request an evidence based explanation of missing observations and next review steps; do not infer a diagnosis from this example alone.`;
  if (/log/i.test(key)) return 'Illustrative log sample:\n09:00 Service started\n09:05 Request completed\n09:10 One delayed request; investigate before drawing conclusions.';
  if (/source/i.test(key)) return 'Illustrative user supplied example; verify against the actual source before use.';
  if (existing && !/notes?|context|description|summary|brief|prompt|text|rationale|constraints?|preferences|signals|input/i.test(key)) return existing;
  if (placeholder && !/^e\.?g\.?|optional|enter|describe|select|comma|list|full|paste|[<(]/i.test(placeholder) && placeholder.length > 10) return `Example ${label.replace(/\s*\(.*?\)|\*/g, '').trim()}: ${placeholder}. Review for ${mode}.`;
  return `Illustrative ${human(label || key).replace(/\*/g, '').trim().toLowerCase()} for ${context || 'this workflow'}: prepare ${mode}. Use the supplied information, identify missing evidence, and keep recommendations subject to review.`;
}

export function fillNativeFields(scope, variant = 0, context = '') {
  const controls = Array.from(scope.querySelectorAll('input, textarea, select'));
  let filled = 0;
  const manual = [];
  controls.forEach((element) => {
    if (element.disabled || element.readOnly || element.hasAttribute('data-ai-exclude') || element.closest('[hidden], [aria-hidden="true"]') || ['hidden', 'submit', 'button', 'reset', 'password', 'search'].includes(element.type)) return;
    const key = element.dataset.aiField || element.name || element.id || '', label = labelFor(element);
    if (element.type === 'file' || evidenceKey(key)) {
      if (!element.value) manual.push(label || human(key) || 'Source file');
      return;
    }
    let value;
    if (element.tagName === 'SELECT') {
      const options = Array.from(element.options).filter((option) => option.value && !option.disabled && !option.hidden);
      if (!options.length) { manual.push(label || human(key) || 'Record selection'); return; }
      // A linked record is always a real option loaded by the native page.
      value = referenceKey(key) && element.value ? element.value : options[Math.min(variant, options.length - 1)].value;
    } else if (referenceKey(key) || /\b(?:record|patient|device|menu|batch|document|client|case|memory|field|plot|unit|group|ride|zone|restaurant|building|source|trial|campaign|influencer|customer|account|policy|machine)\s+ids?\b/i.test(label)) {
      if (!element.value) manual.push(label || human(key));
      return;
    } else if (element.type === 'checkbox' || element.type === 'radio') {
      if (element.type === 'checkbox') {
        // Human consent, approval and operational decisions always stay manual.
        if (/consent|approv|acknowledg|publish|notify|notification|authoriz|certif|confirm|human|verify/i.test(key + ' ' + label)) {
          if (element.required && !element.checked) manual.push(label || human(key) || 'Required acknowledgment');
          return;
        }
        const checked = variant !== 1;
        if (element.checked !== checked) flushSync(() => element.click());
        filled += 1;
        return;
      }
      if (element.type === 'radio' && element.name && scope.querySelector(`input[type="radio"][name="${element.name.replace(/["\\]/g, '\\$&')}"]:checked`)) return;
      if (!element.checked) flushSync(() => element.click());
      filled += 1;
      return;
    } else if (element.type === 'number' || element.type === 'range') value = numeric(element, key, variant);
    else if (element.type === 'date' || element.type === 'datetime-local') {
      const date = new Date(); date.setDate(date.getDate() + [7, 14, 30][variant]);
      value = date.toISOString().slice(0, element.type === 'date' ? 10 : 16);
      if (element.min && value < element.min) value = element.min;
      if (element.max && value > element.max) value = element.max;
    } else if (element.type === 'time') value = ['09:00', '12:00', '15:00'][variant];
    else if (element.type === 'email') value = ['reviewer@example.com', 'team@example.com', 'owner@example.com'][variant];
    else if (element.type === 'url') { if (!element.value) manual.push(label || human(key)); return; }
    else value = textExample(element, key, label, variant, context);
    if (value === null) { manual.push(label || human(key) || 'Source data'); return; }
    const prototype = element.tagName === 'TEXTAREA' ? window.HTMLTextAreaElement.prototype : element.tagName === 'SELECT' ? window.HTMLSelectElement.prototype : window.HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(prototype, 'value')?.set;
    flushSync(() => {
      if (setter) setter.call(element, value); else element.value = value;
      element.dispatchEvent(new Event(element.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true }));
      if (element.tagName !== 'SELECT') element.dispatchEvent(new Event('change', { bubbles: true }));
    });
    filled += 1;
  });
  return { filled, manual: [...new Set(manual)] };
}

export default function NativeAIControls({ children, busy = false, onCancel, context = '', presets = null }) {
  const scope = useRef(null);
  const [message, setMessage] = useState('');
  const choices = Array.isArray(presets) ? presets : variants.map((name) => ({ name }));
  const fill = (variant) => {
    let result;
    if (choices[variant].fill) flushSync(() => { result = choices[variant].fill(); });
    else result = fillNativeFields(scope.current, variant, context);
    const { filled = 0, manual = [] } = result || {};
    if (!filled && !manual.length) { setMessage('No editable AI request is open. Select a tool or open its request form first.'); return; }
    setMessage(`${filled} editable field${filled === 1 ? '' : 's'} filled. ${manual.length ? `Supply actual ${manual.join(', ')} before running when required.` : 'Review the example, then use the Run button below.'}`);
  };
  return <section className="native-ai-scope" ref={scope}>
    <div className="native-ai-controls">
      <div><strong>Demo AI · fill all fields</strong><span>Fill every visible editable AI field, including optional context, with fictional examples. Real records, uploads and review decisions remain yours.</span></div>
      <div className="native-ai-control-buttons">{choices.map(({name}, index) => <button key={name} type="button" disabled={busy} onClick={() => fill(index)}>{`Demo AI · ${name}`}</button>)}{busy && onCancel && <button type="button" className="native-ai-cancel" onClick={onCancel}>Cancel request</button>}</div>
      {message && <p role="status">{message}</p>}
    </div>
    {children}
  </section>;
}
