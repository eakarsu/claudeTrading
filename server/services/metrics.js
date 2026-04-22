/**
 * Tiny in-process metrics registry.
 *
 * We deliberately avoid the prom-client dependency — this codebase only needs a
 * handful of counters + one histogram, and the Prom text exposition format is
 * simple enough to hand-roll. If we ever need pushgateway, native histograms,
 * or labeled collectors, swap this out for prom-client without changing the
 * /metrics contract.
 */

// Counter<name, labels...> -> integer. Key is a `${name}|k=v,k=v` string.
const counters = new Map();
// Histogram buckets for HTTP request duration in seconds.
const HTTP_BUCKETS_S = [0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10];
// histogramState<name, labels...> -> { counts:number[], sum, n }
const histograms = new Map();
// Gauge<name> -> number. Simple labelless gauges; good enough here.
const gauges = new Map();

function labelKey(name, labels) {
  const entries = Object.entries(labels || {}).sort(([a], [b]) => (a < b ? -1 : 1));
  if (!entries.length) return name;
  return `${name}|${entries.map(([k, v]) => `${k}=${v}`).join(',')}`;
}

export function incCounter(name, labels = {}, value = 1) {
  const key = labelKey(name, labels);
  counters.set(key, (counters.get(key) || 0) + value);
}

export function observeHistogram(name, valueSeconds, labels = {}) {
  const key = labelKey(name, labels);
  let s = histograms.get(key);
  if (!s) {
    s = { counts: new Array(HTTP_BUCKETS_S.length).fill(0), sum: 0, n: 0 };
    histograms.set(key, s);
  }
  for (let i = 0; i < HTTP_BUCKETS_S.length; i++) {
    if (valueSeconds <= HTTP_BUCKETS_S[i]) s.counts[i]++;
  }
  s.sum += valueSeconds;
  s.n++;
}

export function setGauge(name, value) {
  gauges.set(name, value);
}

function parseKey(key) {
  const [name, labelStr] = key.split('|');
  if (!labelStr) return { name, labels: '' };
  const labels = labelStr
    .split(',')
    .map((kv) => {
      const [k, v] = kv.split('=');
      return `${k}="${String(v).replace(/"/g, '\\"')}"`;
    })
    .join(',');
  return { name, labels: `{${labels}}` };
}

/** Serialize every registered metric to Prometheus text format. */
export function renderMetrics() {
  const lines = [];

  // Counters
  const countersByName = new Map();
  for (const [key, value] of counters) {
    const { name, labels } = parseKey(key);
    const list = countersByName.get(name) || [];
    list.push({ labels, value });
    countersByName.set(name, list);
  }
  for (const [name, list] of countersByName) {
    lines.push(`# TYPE ${name} counter`);
    for (const { labels, value } of list) lines.push(`${name}${labels} ${value}`);
  }

  // Histograms
  const histByName = new Map();
  for (const [key, state] of histograms) {
    const { name, labels } = parseKey(key);
    const list = histByName.get(name) || [];
    list.push({ labels, state });
    histByName.set(name, list);
  }
  for (const [name, list] of histByName) {
    lines.push(`# TYPE ${name} histogram`);
    for (const { labels, state } of list) {
      // Labels-with-le: manually merge the base labels with the le label.
      const base = labels ? labels.slice(0, -1) + ',' : '{';
      for (let i = 0; i < HTTP_BUCKETS_S.length; i++) {
        lines.push(`${name}_bucket${base}le="${HTTP_BUCKETS_S[i]}"} ${state.counts[i]}`);
      }
      lines.push(`${name}_bucket${base}le="+Inf"} ${state.n}`);
      lines.push(`${name}_sum${labels} ${state.sum}`);
      lines.push(`${name}_count${labels} ${state.n}`);
    }
  }

  // Gauges
  for (const [name, value] of gauges) {
    lines.push(`# TYPE ${name} gauge`);
    lines.push(`${name} ${value}`);
  }

  // Always include process uptime + memory so an empty scrape is still useful.
  lines.push('# TYPE process_uptime_seconds gauge');
  lines.push(`process_uptime_seconds ${Math.floor(process.uptime())}`);
  const mem = process.memoryUsage();
  lines.push('# TYPE process_resident_memory_bytes gauge');
  lines.push(`process_resident_memory_bytes ${mem.rss}`);

  return lines.join('\n') + '\n';
}

/**
 * Express middleware that records per-request duration + status counters.
 * Skips /metrics itself so the scraper doesn't inflate its own numbers.
 */
export function metricsMiddleware(req, res, next) {
  if (req.path === '/metrics') return next();
  const start = process.hrtime.bigint();
  res.on('finish', () => {
    const durSec = Number(process.hrtime.bigint() - start) / 1e9;
    const route = req.route?.path ? `${req.baseUrl || ''}${req.route.path}` : req.path;
    const labels = { method: req.method, status: res.statusCode };
    incCounter('http_requests_total', { ...labels, route }, 1);
    observeHistogram('http_request_duration_seconds', durSec, { method: req.method, route });
  });
  next();
}
