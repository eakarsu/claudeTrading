/**
 * AI strategy generator.
 *
 *   POST /api/ai/generate-strategy
 *     Body: { description: "momentum strategy for volatile tech stocks" }
 *
 * Calls the AI to write a strategy function body in the format expected by
 * the existing strategySandbox.js (defineStrategy({...})), validates the
 * generated code for safety, and saves it as a UserStrategy with
 * status 'generated_unverified'.
 *
 * The strategy is NOT activated. Users must review the code in the Strategy
 * Lab editor and run a backtest before enabling it.
 */

import { Router } from 'express';
import { asyncHandler } from '../middleware/async.js';
import { askAI } from '../services/openrouter.js';
import { wrapUserContent } from '../services/promptSafety.js';
import { validateStrategy } from '../services/strategySandbox.js';
import { UserStrategy } from '../models/index.js';
import { BadRequestError } from '../errors.js';

const router = Router();

// ─── Safety whitelist ─────────────────────────────────────────────────────
// We accept only a restricted set of JS constructs in generated code.
// The vm sandbox is the actual runtime boundary; this regex check catches
// obvious policy violations before storage and gives the user a clear error.

/** Tokens that must NOT appear in generated strategy code. */
const FORBIDDEN_PATTERNS = [
  /\brequire\s*\(/,          // CommonJS import
  /\bimport\s*\(/,           // dynamic ESM import
  /\bimport\b/,              // static import statement
  /\bprocess\b/,             // Node.js process object
  /\bfetch\s*\(/,            // network call
  /\bXMLHttpRequest\b/,      // XHR
  /\bWebSocket\b/,           // WebSocket
  /\bfs\b\.|\bpath\b\./,     // filesystem modules
  /\bchild_process\b/,       // shell execution
  /\beval\s*\(/,             // eval
  /\bFunction\s*\(/,         // Function constructor (alternate eval)
  /\bglobalThis\b/,          // global scope escape
  /\bsetTimeout\b|\bsetInterval\b|\bclearTimeout\b|\bclearInterval\b/, // async timing
  /\bnew\s+Worker\b/,        // Web Worker
];

/**
 * Check generated source against the safety whitelist.
 * Returns { safe: true } or { safe: false, reason: string }.
 */
function checkCodeSafety(source) {
  for (const pattern of FORBIDDEN_PATTERNS) {
    if (pattern.test(source)) {
      return { safe: false, reason: `Forbidden pattern detected: ${pattern.source}` };
    }
  }
  return { safe: true };
}

// ─── System prompt for strategy generation ───────────────────────────────

const STRATEGY_SYSTEM_PROMPT = `You are an expert algorithmic trading strategy developer.
Your task is to generate a JavaScript trading strategy using the defineStrategy() API.

The strategy must call defineStrategy({ ... }) with at least populate_entry_trend and populate_exit_trend hooks.

Available context object (ctx) in every hook:
  ctx.bar        — { time, open, high, low, close, volume }
  ctx.i          — current bar index (integer)
  ctx.bars       — full OHLCV array
  ctx.closes     — close price array (length = bars.length)
  ctx.highs      — high price array
  ctx.lows       — low price array
  ctx.volumes    — volume array
  ctx.indicators — { rsi, macd, sma20, sma50, sma200, ema9, ema21, bollinger, stochastic, vwap }
                   Each is an array aligned to bars. macd has .macd, .signal, .histogram sub-arrays.
                   bollinger has .upper, .middle, .lower. stochastic has .k, .d.
  ctx.position   — null if flat, or { side, shares, entryPrice, entryTime, entryIdx }
  ctx.params     — user-supplied params object (always an object, may be empty)

Hook signatures:
  populate_entry_trend(ctx)  -> boolean   // true = enter long
  populate_exit_trend(ctx)   -> boolean   // true = exit long
  custom_stoploss(ctx)       -> number    // absolute stop price (optional)
  custom_exit(ctx)           -> string|null // truthy string = force exit with this reason
  confirm_trade_entry(ctx)   -> boolean   // veto entry (default true)
  confirm_trade_exit(ctx)    -> boolean   // veto exit (default true)
  leverage(ctx)              -> number    // >=1

Rules for generated code:
  - Use ONLY the ctx object and pure Math/Number/Array/Object/Boolean/JSON/String/Date builtins
  - NO require(), import(), fetch(), XMLHttpRequest, WebSocket, process, fs, eval, Function()
  - NO setTimeout / setInterval
  - Guard array accesses: always check ctx.i >= N before indexing ctx.indicators.rsi[ctx.i]
  - The strategy must be concise (under 100 lines) and include a brief comment block

Output ONLY the raw JavaScript code (no markdown fences, no prose before or after).`;

// ─── Route ────────────────────────────────────────────────────────────────

/**
 * POST /api/ai/generate-strategy
 *
 * Body: { description: string, name?: string }
 *
 * Returns:
 *   {
 *     id:          number,     // UserStrategy row id
 *     name:        string,
 *     sourceJs:    string,     // generated code for display / review
 *     warnings:    string[],   // from validateStrategy()
 *     hooks:       string[],   // which hooks were generated
 *     model:       string,
 *     usage:       object,
 *   }
 */
router.post('/', asyncHandler(async (req, res) => {
  const { description, name } = req.body || {};

  if (!description || typeof description !== 'string') {
    throw new BadRequestError('description (string) is required');
  }
  if (description.length > 1000) {
    throw new BadRequestError('description must be ≤1000 characters');
  }

  const strategyName = name?.trim()
    || `AI: ${description.slice(0, 60)}${description.length > 60 ? '…' : ''}`;

  // Ask the AI to generate the strategy. We wrap the user description in
  // injection-fence delimiters consistent with the rest of the platform.
  const userPrompt = wrapUserContent(
    `Generate a complete trading strategy for this description:\n\n${description}\n\n`
    + 'Output ONLY the raw JavaScript code, no explanation, no markdown fences.',
  );

  const result = await askAI(userPrompt, STRATEGY_SYSTEM_PROMPT, { userId: req.userId });
  let sourceJs = String(result.content || '').trim();

  // Strip markdown code fences if the model wrapped the output anyway
  sourceJs = sourceJs
    .replace(/^```(?:javascript|js)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();

  if (!sourceJs) {
    return res.status(502).json({ error: 'AI returned empty strategy code', model: result.model });
  }

  // Safety check before any storage
  const safety = checkCodeSafety(sourceJs);
  if (!safety.safe) {
    return res.status(422).json({
      error: `Generated code failed safety check: ${safety.reason}`,
      sourceJs,
      model: result.model,
    });
  }

  // Validate the code compiles and has at least one hook
  const validation = validateStrategy(sourceJs, {});
  if (!validation.ok) {
    return res.status(422).json({
      error: `Generated code failed syntax/API validation: ${validation.error}`,
      sourceJs,
      model: result.model,
    });
  }

  // Persist as generated_unverified — the user must review and activate
  // manually. We store the status in the notes field since UserStrategy has
  // no status column; this keeps the schema unchanged.
  const notes = `status: generated_unverified\n\nGenerated from description:\n"${description}"`;

  const row = await UserStrategy.create({
    userId: req.userId,
    name: strategyName,
    sourceJs,
    params: {},
    notes,
  });

  res.status(201).json({
    id: row.id,
    name: row.name,
    sourceJs,
    hooks: validation.hooks,
    warnings: validation.warnings,
    model: result.model,
    usage: result.usage,
    message:
      'Strategy generated and saved as unverified. Review the code in Strategy Lab '
      + 'and run a backtest before activating.',
  });
}));

export default router;
