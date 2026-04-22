import { TelegramConfig, AutoTraderState, AutoTraderTrade } from '../models/index.js';
import * as alpaca from './alpaca.js';
import { stopAutoTrader } from './autoTrader.js';
import { logger } from '../logger.js';
import { Op } from 'sequelize';

/**
 * Telegram bot — per-user HTTP long-polling loop.
 *
 * Users register their bot token + authorized chat ID via the /api/telegram
 * CRUD. A background loop per user calls getUpdates (long-poll) and dispatches
 * a handful of read-only + control commands:
 *
 *   /status      → auto-trader on/off + active strategy + symbols
 *   /balance     → equity + buying power from Alpaca
 *   /positions   → open positions with unrealized P&L
 *   /daily       → today's realized P&L from AutoTraderTrade
 *   /forceexit   → /forceexit SYMBOL — close an open position via Alpaca
 *   /stop        → halt the auto-trader
 *   /help        → command list
 *
 * Commands from unauthorized chats are ignored. If the bot token is invalid
 * the loop pauses and records the last error on the config row.
 */

const API = 'https://api.telegram.org';
const POLL_TIMEOUT_S = 25;           // long-poll — Telegram holds up to 50s
const BACKOFF_BASE_MS = 5_000;
const BACKOFF_MAX_MS  = 60_000;

// userId → { cancelled: boolean, backoff: number }
const loops = new Map();

async function tgFetch(token, method, params) {
  const url = `${API}/bot${token}/${method}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params || {}),
  });
  const data = await res.json();
  if (!data.ok) throw new Error(`Telegram API: ${data.description || res.status}`);
  return data.result;
}

export async function sendTelegramMessage(userId, text) {
  const cfg = await TelegramConfig.findOne({ where: { userId, active: true } });
  if (!cfg) return;
  try {
    await tgFetch(cfg.botToken, 'sendMessage', {
      chat_id: cfg.chatId,
      text,
      parse_mode: 'Markdown',
    });
  } catch (err) {
    await cfg.update({ lastError: err.message }).catch(() => {});
  }
}

// ─── Command handlers ───
async function handleStatus(userId) {
  const state = await AutoTraderState.findOne({ where: { userId } });
  if (!state) return '_No auto-trader state yet._';
  const running = state.running ? 'RUNNING' : 'stopped';
  const strat = state.activeStrategy || '—';
  const syms = (state.config?.symbols || []).join(', ') || '—';
  return `*Auto-trader*: ${running}\n*Strategy*: \`${strat}\`\n*Symbols*: ${syms}`;
}

async function handleBalance() {
  try {
    const a = await alpaca.getAccount();
    return `*Equity*: $${Number(a.equity).toFixed(2)}\n*Buying power*: $${Number(a.buying_power).toFixed(2)}\n*Cash*: $${Number(a.cash).toFixed(2)}`;
  } catch (e) { return `Balance failed: ${e.message}`; }
}

async function handlePositions() {
  try {
    const pos = await alpaca.getPositions();
    if (!pos.length) return '_No open positions._';
    return pos.map((p) => {
      const pnl = Number(p.unrealized_pl) || 0;
      const pct = Number(p.unrealized_plpc) || 0;
      const sign = pnl >= 0 ? '+' : '';
      return `\`${p.symbol}\` ${p.qty}@$${Number(p.avg_entry_price).toFixed(2)} → $${Number(p.current_price).toFixed(2)} ${sign}$${pnl.toFixed(2)} (${(pct * 100).toFixed(2)}%)`;
    }).join('\n');
  } catch (e) { return `Positions failed: ${e.message}`; }
}

async function handleDaily(userId) {
  return summarizeWindow(userId, 1, 'Today');
}
async function handleWeekly(userId) {
  return summarizeWindow(userId, 7, 'Last 7d');
}
async function handleMonthly(userId) {
  return summarizeWindow(userId, 30, 'Last 30d');
}

async function summarizeWindow(userId, days, label) {
  const since = new Date(Date.now() - days * 86_400_000);
  const trades = await AutoTraderTrade.findAll({
    where: { userId, action: 'sell', pnl: { [Op.ne]: null }, createdAt: { [Op.gte]: since } },
  });
  if (!trades.length) return `_No closed trades in ${label.toLowerCase()}._`;
  const total = trades.reduce((s, t) => s + (Number(t.pnl) || 0), 0);
  const wins = trades.filter((t) => Number(t.pnl) > 0).length;
  const sign = total >= 0 ? '+' : '';
  return `*${label}*: ${trades.length} trades, ${wins}W / ${trades.length - wins}L, P&L ${sign}$${total.toFixed(2)}`;
}

async function handleProfit(userId) {
  const closed = await AutoTraderTrade.findAll({
    where: { userId, action: 'sell', pnl: { [Op.ne]: null } },
  });
  if (!closed.length) return '_No closed trades yet._';
  const total = closed.reduce((s, t) => s + Number(t.pnl), 0);
  const wins = closed.filter((t) => Number(t.pnl) > 0);
  const winRate = ((wins.length / closed.length) * 100).toFixed(1);
  const sign = total >= 0 ? '+' : '';
  return `*Profit (all time)*: ${sign}$${total.toFixed(2)}\n*Trades*: ${closed.length}  *Win rate*: ${winRate}%`;
}

async function handlePerformance(userId) {
  const rows = await AutoTraderTrade.findAll({
    where: { userId, action: 'sell', pnl: { [Op.ne]: null } },
  });
  if (!rows.length) return '_No closed trades yet._';
  const bySym = {};
  for (const r of rows) {
    const s = (bySym[r.symbol] ||= { sym: r.symbol, pnl: 0, n: 0 });
    s.pnl += Number(r.pnl); s.n += 1;
  }
  const top = Object.values(bySym).sort((a, b) => b.pnl - a.pnl).slice(0, 10);
  return '*Performance (top 10):*\n' +
    top.map((s) => `\`${s.sym}\` ${s.pnl >= 0 ? '+' : ''}$${s.pnl.toFixed(2)} (${s.n})`).join('\n');
}

async function handleStats(userId) {
  const all = await AutoTraderTrade.findAll({
    where: { userId, action: 'sell', pnl: { [Op.ne]: null } },
  });
  if (!all.length) return '_No closed trades yet._';
  const wins = all.filter((t) => Number(t.pnl) > 0);
  const losses = all.filter((t) => Number(t.pnl) < 0);
  const avgWin = wins.length ? wins.reduce((s, t) => s + Number(t.pnl), 0) / wins.length : 0;
  const avgLoss = losses.length ? losses.reduce((s, t) => s + Number(t.pnl), 0) / losses.length : 0;
  return `*Stats*: ${all.length} trades\n  wins ${wins.length} avg $${avgWin.toFixed(2)}\n  losses ${losses.length} avg $${avgLoss.toFixed(2)}`;
}

async function handleCount(userId) {
  try {
    const pos = await alpaca.getPositions();
    const state = await AutoTraderState.findOne({ where: { userId } });
    return `*Open*: ${pos.length} / max ${state?.config?.maxOpenPositions ?? '—'}`;
  } catch (e) { return `Count failed: ${e.message}`; }
}

async function handleForceExit(args) {
  const symbol = (args[0] || '').toUpperCase();
  if (!symbol) return 'Usage: `/forceexit SYMBOL`';
  try {
    await alpaca.closePosition(symbol);
    return `Closing \`${symbol}\`…`;
  } catch (e) { return `ForceExit failed: ${e.message}`; }
}

async function handleStop(userId) {
  try {
    await stopAutoTrader(userId);
    return 'Auto-trader stopped.';
  } catch (e) { return `Stop failed: ${e.message}`; }
}

function handleHelp() {
  return [
    '*Available commands:*',
    '`/status` — auto-trader state',
    '`/balance` — account equity',
    '`/positions` — open positions',
    '`/daily` `/weekly` `/monthly` — bucketed P&L',
    '`/profit` — all-time P&L + win rate',
    '`/performance` — top 10 symbols by P&L',
    '`/stats` — wins/losses breakdown',
    '`/count` — open positions / max',
    '`/forceexit SYM` — close a position',
    '`/stop` — halt the auto-trader',
    '`/help` — this message',
  ].join('\n');
}

async function dispatchCommand(userId, text) {
  const parts = text.trim().split(/\s+/);
  const cmd = parts[0].toLowerCase().replace(/@.*/, ''); // strip @botname
  const args = parts.slice(1);
  switch (cmd) {
    case '/start':
    case '/help':      return handleHelp();
    case '/status':    return handleStatus(userId);
    case '/balance':   return handleBalance();
    case '/positions': return handlePositions();
    case '/daily':     return handleDaily(userId);
    case '/weekly':    return handleWeekly(userId);
    case '/monthly':   return handleMonthly(userId);
    case '/profit':    return handleProfit(userId);
    case '/performance': return handlePerformance(userId);
    case '/stats':     return handleStats(userId);
    case '/count':     return handleCount(userId);
    case '/forceexit': return handleForceExit(args);
    case '/stop':      return handleStop(userId);
    default:           return null; // ignore non-commands + unknown commands silently
  }
}

// ─── Long-polling loop ───
async function pollOnce(cfg) {
  const updates = await tgFetch(cfg.botToken, 'getUpdates', {
    offset: Number(cfg.lastUpdateId || 0) + 1,
    timeout: POLL_TIMEOUT_S,
    allowed_updates: ['message'],
  });
  if (!updates.length) return;

  let maxId = Number(cfg.lastUpdateId || 0);
  for (const u of updates) {
    if (u.update_id > maxId) maxId = u.update_id;
    const msg = u.message;
    if (!msg || !msg.text) continue;
    // Authorization: accept messages only from the configured chat_id.
    if (String(msg.chat.id) !== String(cfg.chatId)) continue;
    const reply = await dispatchCommand(cfg.userId, msg.text).catch((err) => `Error: ${err.message}`);
    if (reply) {
      await tgFetch(cfg.botToken, 'sendMessage', {
        chat_id: cfg.chatId, text: reply, parse_mode: 'Markdown',
      }).catch((err) => logger.warn({ err, userId: cfg.userId }, 'telegram reply failed'));
    }
  }
  await cfg.update({ lastUpdateId: maxId, lastError: null });
}

async function runLoop(userId) {
  const state = { cancelled: false, backoff: BACKOFF_BASE_MS };
  loops.set(userId, state);
  while (!state.cancelled) {
    const cfg = await TelegramConfig.findOne({ where: { userId, active: true } });
    if (!cfg) { state.cancelled = true; break; }
    try {
      await pollOnce(cfg);
      state.backoff = BACKOFF_BASE_MS;
    } catch (err) {
      await cfg.update({ lastError: err.message }).catch(() => {});
      logger.warn({ err: err.message, userId }, 'telegram poll failed — backing off');
      await new Promise((r) => setTimeout(r, state.backoff));
      state.backoff = Math.min(BACKOFF_MAX_MS, state.backoff * 2);
    }
  }
  loops.delete(userId);
}

export function startTelegramLoop(userId) {
  if (loops.has(userId)) return;
  runLoop(userId).catch((err) => logger.error({ err, userId }, 'telegram loop crashed'));
}

export function stopTelegramLoop(userId) {
  const state = loops.get(userId);
  if (state) state.cancelled = true;
}

/** Resume loops for all configured users (called on server start). */
export async function resumeTelegramLoops() {
  const cfgs = await TelegramConfig.findAll({ where: { active: true } });
  for (const cfg of cfgs) startTelegramLoop(cfg.userId);
}
