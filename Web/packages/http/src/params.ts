import type { Request } from 'express';

/**
 * Reads a path parameter as a string.
 *
 * Express 5 types `req.params` values as `string | string[]`, because its
 * router can bind the same name more than once. The route patterns here never
 * do, but the union is real and a non-null assertion does not narrow it — so
 * without this every service reaches for a cast, and casts are where wrong
 * assumptions go to hide.
 */
export function pathParam(req: Request, name: string): string {
  const value = req.params[name];
  if (Array.isArray(value)) return value[0] ?? '';
  return value ?? '';
}
