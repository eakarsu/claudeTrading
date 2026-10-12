'use strict';
const crypto = require('node:crypto');
const parameters = (values = []) => values.map((value) => value && typeof value === 'object' && !(value instanceof Date) && !Buffer.isBuffer(value) ? JSON.stringify(value) : value);
function sequelizeQueryClient(sequelize) {
  return { query: async (text, values) => {
    const [rows] = await sequelize.query(text, { bind: parameters(values), raw: true });
    return { rows: Array.isArray(rows) ? rows : [] };
  } };
}
function knexQueryClient(knex) {
  return { query: async (text, values = []) => {
    const bindings = [];
    const prepared = text.replace(/\$(\d+)/g, (_match, index) => { bindings.push(parameters([values[Number(index) - 1]])[0]); return '?'; });
    return knex.raw(prepared, bindings);
  } };
}
function prismaQueryClient(prisma) {
  const normalize = (value) => typeof value === 'bigint' ? String(value) : value instanceof Date ? value : Array.isArray(value) ? value.map(normalize) : value && typeof value === 'object' ? Object.fromEntries(Object.entries(value).map(([key, item]) => [key, normalize(item)])) : value;
  return { query: async (text, values) => {
    if (/^\s*(?:CREATE|ALTER|DROP)\b/i.test(text)) { await prisma.$executeRawUnsafe(text, ...parameters(values)); return { rows: [] }; }
    // Prisma sends string bind types explicitly; PostgreSQL requires the target
    // casts for the report table's JSONB values and BIGSERIAL identifier.
    const typed = text.replace(/\b(input|result_json|usage)\s*=\s*(\$\d+)/g, '$1=$2::jsonb').replace('VALUES ($1,$2,$3,$4,$5,$6,$7)', 'VALUES ($1,$2,$3::jsonb,$4,$5::jsonb,$6,$7::jsonb)').replace(/\bid\s*=\s*(\$\d+)/g, 'id=$1::bigint');
    return { rows: normalize(await prisma.$queryRawUnsafe(typed, ...parameters(values))) };
  } };
}
function runtimeSessionAuth(pool, authenticate) {
  return async (req, res, next) => {
    const token = /^Bearer\s+(.+)$/i.exec(req.headers.authorization || '')?.[1];
    if (/^[a-f0-9]{64}$/i.test(token || '')) {
      try {
        const hash = crypto.createHash('sha256').update(token).digest('hex');
        const session = await pool.query(`SELECT u.id,u.email,u.display_name,u.role FROM runtime_app_sessions s JOIN runtime_app_users u ON u.id=s.user_id WHERE s.token_hash=$1 AND s.expires_at>NOW() AND u.active=TRUE LIMIT 1`, [hash]);
        if (session.rows.length) { req.user = { ...session.rows[0], id: `runtime:${session.rows[0].id}` }; return next(); }
      } catch (_) { /* Preserve native authentication when no runtime session exists. */ }
    }
    return authenticate(req, res, next);
  };
}
function verifiedActorAuth(authenticate) {
  return (req, res, next) => authenticate(req, res, () => {
    if (!req.user && (req.auth || req.principal)) {
      const actor = req.auth || req.principal;
      req.user = { id: actor.profileId ? `${actor.profileId}:${actor.userId || actor.id || actor.subject}` : actor.userId || actor.id || actor.subject, tenantId: actor.tenantId || actor.organizationId };
    }
    if (req.user?.organizationId != null && req.user.tenantId == null) req.user = { ...req.user, tenantId: req.user.organizationId };
    next();
  });
}
function createWorkspaceLimiter({ limit = 20, windowMs = 60 * 60 * 1000, now = Date.now } = {}) {
  const requests = new Map(); let calls = 0;
  return (req, res, next) => {
    const owner = req.aiWorkspaceOwner;
    if (!owner) return res.status(401).json({ error: 'Sign in to generate a report.' });
    const time = now(); let entry = requests.get(owner);
    if (!entry || time >= entry.reset) { entry = { count: 0, reset: time + windowMs }; requests.set(owner, entry); }
    if (++calls % 100 === 0) for (const [key, value] of requests) if (time >= value.reset) requests.delete(key);
    if (entry.count >= limit) { res.setHeader('Retry-After', Math.ceil((entry.reset - time) / 1000)); return res.status(429).json({ error: `AI report limit reached. Maximum ${limit} requests per hour per user.` }); }
    entry.count += 1; next();
  };
}
module.exports = { sequelizeQueryClient, prismaQueryClient, knexQueryClient, runtimeSessionAuth, verifiedActorAuth, createWorkspaceLimiter };
