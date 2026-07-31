import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { z, type ZodTypeAny } from 'zod';
import { DomainError } from './services/skills.js';

/** Wraps an async handler so a rejected promise reaches the error middleware. */
export function h(fn: (req: Request, res: Response) => Promise<unknown> | unknown): RequestHandler {
  return (req, res, next) => {
    try {
      const result = fn(req, res);
      if (result instanceof Promise) result.catch(next);
    } catch (err) {
      next(err);
    }
  };
}

/**
 * Express 5 types route params as `string | string[]`, which is never what a
 * `:slug` segment actually is. This narrows it in one place.
 */
export function param(req: Request, name: string): string {
  const value = (req.params as Record<string, string | string[] | undefined>)[name];
  if (Array.isArray(value)) return value[0] ?? '';
  return value ?? '';
}

export function parse<T extends ZodTypeAny>(schema: T, data: unknown): z.infer<T> {
  const result = schema.safeParse(data);
  if (!result.success) {
    const issue = result.error.issues[0];
    throw new DomainError(
      `${issue.path.join('.') || 'body'}: ${issue.message}`.trim(),
      422,
    );
  }
  return result.data;
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function errorHandler(err: unknown, _req: Request, res: Response, _next: NextFunction): void {
  if (err instanceof DomainError) {
    res.status(err.status).json({ error: err.message });
    return;
  }
  const message = err instanceof Error ? err.message : 'unexpected error';
  if (/UNIQUE constraint/i.test(message)) {
    res.status(409).json({ error: 'that already exists' });
    return;
  }
  console.error('[shkills] unhandled error:', err);
  res.status(500).json({ error: 'internal server error' });
}
