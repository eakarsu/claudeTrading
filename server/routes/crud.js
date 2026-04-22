import { Router } from 'express';
import { Op } from 'sequelize';
import { asyncHandler } from '../middleware/async.js';
import { validate } from '../middleware/validate.js';
import { askAI } from '../services/openrouter.js';
import { wrapUserContent } from '../services/promptSafety.js';
import { idParam, paginationQuery } from '../schemas.js';
import { NotFoundError } from '../errors.js';
import { toCsv } from '../services/csv.js';

/**
 * Generic CRUD + AI router for a Sequelize model.
 * Uses `createdAt` for default ordering (stable — `updatedAt` would re-order
 * every time an AI analysis is written back to the row).
 */
export function createCrudRouter(Model, name, aiPromptFn) {
  const router = Router();

  // All CRUD queries are scoped by the caller's userId — multi-user isolation.
  // We also accept rows with a NULL userId so pre-migration legacy data stays
  // visible; once a row is touched (update/analyze) we stamp the current user
  // onto it to migrate it forward.
  // Some models (e.g. MarketNews) are shared/global feeds without a userId
  // column — detect that and skip scoping so queries don't reference a
  // non-existent column.
  const isScoped = Object.prototype.hasOwnProperty.call(Model.rawAttributes, 'userId');
  const scopedWhere = (req) => (isScoped ? { userId: { [Op.or]: [req.userId, null] } } : {});

  // Ad-hoc AI query — declared BEFORE /:id so "ai" isn't parsed as an id.
  router.post('/ai/ask', asyncHandler(async (req, res) => {
    const { prompt, context } = req.body ?? {};
    const safePrompt = wrapUserContent(prompt);
    const safeContext = context ? wrapUserContent(context) : '';
    const result = await askAI(safePrompt, safeContext, { userId: req.userId });
    res.json({ analysis: result.content, model: result.model, usage: result.usage });
  }));

  router.get('/', validate({ query: paginationQuery }), asyncHandler(async (req, res) => {
    const { limit, offset } = req.query;
    const { rows, count } = await Model.findAndCountAll({
      where: scopedWhere(req),
      order: [['createdAt', 'DESC']],
      limit, offset,
    });
    res.json({ items: rows, total: count, limit, offset });
  }));

  // CSV export — must be declared before /:id so "export.csv" isn't parsed as
  // an id. Columns are inferred from the model's rawAttributes minus Sequelize
  // internals; rows are capped at 5000 to keep response size bounded.
  router.get('/export.csv', asyncHandler(async (req, res) => {
    const rows = await Model.findAll({
      where: scopedWhere(req),
      order: [['createdAt', 'DESC']],
      limit: 5000,
    });
    const columns = Object.keys(Model.rawAttributes);
    const csv = toCsv(rows.map((r) => r.toJSON()), columns);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${name.replace(/\s+/g, '-').toLowerCase()}-${Date.now()}.csv"`);
    res.send(csv);
  }));

  router.get('/:id', validate({ params: idParam }), asyncHandler(async (req, res) => {
    const item = await Model.findOne({ where: { id: req.params.id, ...scopedWhere(req) } });
    if (!item) throw new NotFoundError(`${name} not found`);
    res.json(item);
  }));

  router.post('/', asyncHandler(async (req, res) => {
    // Force userId onto new rows so a client can't spoof another user's row.
    const payload = isScoped ? { ...req.body, userId: req.userId } : { ...req.body };
    const item = await Model.create(payload);
    res.status(201).json(item);
  }));

  router.put('/:id', validate({ params: idParam }), asyncHandler(async (req, res) => {
    const item = await Model.findOne({ where: { id: req.params.id, ...scopedWhere(req) } });
    if (!item) throw new NotFoundError(`${name} not found`);
    // Ignore attempts to hijack ownership.
    const { userId: _ignored, ...rest } = req.body || {};
    await item.update(isScoped ? { ...rest, userId: req.userId } : rest);
    res.json(item);
  }));

  router.delete('/:id', validate({ params: idParam }), asyncHandler(async (req, res) => {
    const item = await Model.findOne({ where: { id: req.params.id, ...scopedWhere(req) } });
    if (!item) throw new NotFoundError(`${name} not found`);
    await item.destroy();
    res.json({ success: true });
  }));

  router.post('/:id/analyze', validate({ params: idParam }), asyncHandler(async (req, res) => {
    const item = await Model.findOne({ where: { id: req.params.id, ...scopedWhere(req) } });
    if (!item) throw new NotFoundError(`${name} not found`);
    const prompt = aiPromptFn(item.toJSON());
    const result = await askAI(prompt, '', { userId: req.userId });
    await item.update(isScoped
      ? { aiAnalysis: result.content, userId: req.userId }
      : { aiAnalysis: result.content });
    res.json({ analysis: result.content, model: result.model, usage: result.usage });
  }));

  return router;
}
