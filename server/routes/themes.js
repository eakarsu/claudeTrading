import express from 'express';
import { Theme, ThemeConstituent, ThemeAlert, User } from '../models/index.js';
import { getLatestTradePrices } from '../services/priceCache.js';
import { logger } from '../logger.js';

const router = express.Router();

// ─── Admin gating ─────────────────────────────────────────────────────────
// The app has no role column on User. To keep the blast radius of CRUD
// mutations small we resolve admin from ADMIN_EMAIL env. If the env is unset
// in a dev/demo build we fall back to the seeded demo user so the feature
// isn't locked out of a fresh local install.
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || 'trader@claude.ai';

async function requireAdmin(req, res, next) {
  try {
    const user = await User.findByPk(req.userId);
    if (!user || user.email !== ADMIN_EMAIL) {
      return res.status(403).json({ error: 'Admin only' });
    }
    next();
  } catch (err) {
    logger.warn({ err }, 'admin check failed');
    res.status(500).json({ error: 'Admin check failed' });
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────
async function serializeTheme(theme, { withQuotes = false } = {}) {
  const constituents = await ThemeConstituent.findAll({
    where: { themeId: theme.id },
    order: [['symbol', 'ASC']],
  });

  let quotes = {};
  if (withQuotes && constituents.length) {
    try {
      quotes = await getLatestTradePrices(constituents.map((c) => c.symbol));
    } catch (err) {
      // Live quotes are nice-to-have. If the upstream is rate-limited or
      // misconfigured, return the theme without prices rather than 500ing.
      logger.warn({ err, themeId: theme.id }, 'theme quote fetch failed');
    }
  }

  return {
    id: theme.id,
    slug: theme.slug,
    name: theme.name,
    tagline: theme.tagline,
    thesisMd: theme.thesisMd,
    disclaimer: theme.disclaimer,
    order: theme.order,
    constituents: constituents.map((c) => ({
      id: c.id,
      symbol: c.symbol,
      rationale: c.rationale,
      weight: c.weight,
      quote: quotes[c.symbol] || null,
    })),
  };
}

// ─── Public GETs (any authenticated user) ─────────────────────────────────
router.get('/', async (req, res, next) => {
  try {
    const themes = await Theme.findAll({ order: [['order', 'ASC'], ['id', 'ASC']] });
    const out = [];
    for (const t of themes) out.push(await serializeTheme(t));
    res.json({ items: out, total: out.length });
  } catch (err) { next(err); }
});

router.get('/:slug', async (req, res, next) => {
  try {
    const theme = await Theme.findOne({ where: { slug: req.params.slug } });
    if (!theme) return res.status(404).json({ error: 'Theme not found' });
    const withQuotes = req.query.quotes !== 'false';
    res.json(await serializeTheme(theme, { withQuotes }));
  } catch (err) { next(err); }
});

// ─── Admin CRUD ───────────────────────────────────────────────────────────
router.post('/', requireAdmin, async (req, res, next) => {
  try {
    const { slug, name, tagline, thesisMd, disclaimer, order } = req.body || {};
    if (!slug || !name) return res.status(400).json({ error: 'slug + name required' });
    const theme = await Theme.create({ slug, name, tagline, thesisMd, disclaimer, order });
    res.status(201).json(await serializeTheme(theme));
  } catch (err) {
    if (err.name === 'SequelizeUniqueConstraintError') {
      return res.status(409).json({ error: 'slug already exists' });
    }
    next(err);
  }
});

router.put('/:slug', requireAdmin, async (req, res, next) => {
  try {
    const theme = await Theme.findOne({ where: { slug: req.params.slug } });
    if (!theme) return res.status(404).json({ error: 'Theme not found' });
    const { name, tagline, thesisMd, disclaimer, order } = req.body || {};
    await theme.update({
      ...(name != null ? { name } : {}),
      ...(tagline != null ? { tagline } : {}),
      ...(thesisMd != null ? { thesisMd } : {}),
      ...(disclaimer != null ? { disclaimer } : {}),
      ...(order != null ? { order } : {}),
    });
    res.json(await serializeTheme(theme));
  } catch (err) { next(err); }
});

router.delete('/:slug', requireAdmin, async (req, res, next) => {
  try {
    const theme = await Theme.findOne({ where: { slug: req.params.slug } });
    if (!theme) return res.status(404).json({ error: 'Theme not found' });
    await ThemeConstituent.destroy({ where: { themeId: theme.id } });
    await ThemeAlert.destroy({ where: { themeId: theme.id } });
    await theme.destroy();
    res.json({ ok: true });
  } catch (err) { next(err); }
});

// ─── Constituent CRUD (admin only) ────────────────────────────────────────
router.post('/:slug/constituents', requireAdmin, async (req, res, next) => {
  try {
    const theme = await Theme.findOne({ where: { slug: req.params.slug } });
    if (!theme) return res.status(404).json({ error: 'Theme not found' });
    const { symbol, rationale, weight } = req.body || {};
    if (!symbol) return res.status(400).json({ error: 'symbol required' });
    const normSym = String(symbol).toUpperCase().trim();
    const row = await ThemeConstituent.create({
      themeId: theme.id,
      symbol: normSym,
      rationale: rationale || null,
      weight: weight != null ? Number(weight) : 1.0,
    });
    res.status(201).json({ id: row.id, symbol: row.symbol, rationale: row.rationale, weight: row.weight });
  } catch (err) {
    if (err.name === 'SequelizeUniqueConstraintError') {
      return res.status(409).json({ error: 'symbol already in this theme' });
    }
    next(err);
  }
});

router.delete('/:slug/constituents/:symbol', requireAdmin, async (req, res, next) => {
  try {
    const theme = await Theme.findOne({ where: { slug: req.params.slug } });
    if (!theme) return res.status(404).json({ error: 'Theme not found' });
    const n = await ThemeConstituent.destroy({
      where: { themeId: theme.id, symbol: String(req.params.symbol).toUpperCase() },
    });
    if (!n) return res.status(404).json({ error: 'constituent not found' });
    res.json({ ok: true });
  } catch (err) { next(err); }
});

// ─── Theme-basket alerts (per-user) ───────────────────────────────────────
router.get('/:slug/alerts', async (req, res, next) => {
  try {
    const theme = await Theme.findOne({ where: { slug: req.params.slug } });
    if (!theme) return res.status(404).json({ error: 'Theme not found' });
    const alerts = await ThemeAlert.findAll({
      where: { themeId: theme.id, userId: req.userId },
      order: [['createdAt', 'DESC']],
    });
    res.json({ items: alerts });
  } catch (err) { next(err); }
});

router.post('/:slug/alerts', async (req, res, next) => {
  try {
    const theme = await Theme.findOne({ where: { slug: req.params.slug } });
    if (!theme) return res.status(404).json({ error: 'Theme not found' });
    const { kind = 'basket-change-pct', threshold, notes } = req.body || {};
    if (threshold == null || Number.isNaN(Number(threshold))) {
      return res.status(400).json({ error: 'threshold required (number)' });
    }
    // Stamp a baseline for basket-change alerts — equal-weight average of
    // current prices. If quote fetch fails we fall back to null and the
    // evaluator will stamp on first tick instead.
    let baseline = null;
    if (kind === 'basket-change-pct') {
      try {
        const constituents = await ThemeConstituent.findAll({ where: { themeId: theme.id } });
        const quotes = await getLatestTradePrices(constituents.map((c) => c.symbol));
        const prices = constituents
          .map((c) => quotes[c.symbol]?.price)
          .filter((p) => typeof p === 'number' && Number.isFinite(p));
        if (prices.length) baseline = prices.reduce((a, b) => a + b, 0) / prices.length;
      } catch (err) {
        logger.warn({ err }, 'theme alert baseline fetch failed — will stamp on first tick');
      }
    }
    const row = await ThemeAlert.create({
      userId: req.userId,
      themeId: theme.id,
      kind,
      threshold: Number(threshold),
      baseline,
      status: 'active',
      notes: notes || null,
    });
    res.status(201).json(row);
  } catch (err) { next(err); }
});

router.delete('/:slug/alerts/:id', async (req, res, next) => {
  try {
    const theme = await Theme.findOne({ where: { slug: req.params.slug } });
    if (!theme) return res.status(404).json({ error: 'Theme not found' });
    const n = await ThemeAlert.destroy({
      where: { id: req.params.id, themeId: theme.id, userId: req.userId },
    });
    if (!n) return res.status(404).json({ error: 'alert not found' });
    res.json({ ok: true });
  } catch (err) { next(err); }
});

export default router;
