/**
 * Zod request-validation middleware. Use like:
 *   router.post('/x', validate({ body: bodySchema, query: querySchema }), handler)
 * Parsed (and type-coerced) values are written back onto req.body / req.query.
 */
export function validate({ body, query, params }) {
  return (req, res, next) => {
    try {
      if (body) req.body = body.parse(req.body ?? {});
      if (query) req.query = query.parse(req.query ?? {});
      if (params) req.params = params.parse(req.params ?? {});
      next();
    } catch (err) {
      next(err);
    }
  };
}
