import type { NextFunction, Request, Response } from 'express';
import { logger } from '../logger.js';

export class AppError extends Error {
  readonly statusCode: number;
  readonly code: string;

  constructor(message: string, statusCode = 500, code = 'INTERNAL_ERROR') {
    super(message);
    this.name = 'AppError';
    this.statusCode = statusCode;
    this.code = code;
  }
}

export function errorHandler(
  err: unknown,
  req: Request,
  res: Response,
  _next: NextFunction
): void {
  if (err instanceof AppError) {
    logger.warn('Handled application error', {
      path: req.path,
      method: req.method,
      statusCode: err.statusCode,
      code: err.code,
      message: err.message,
    });
    res.status(err.statusCode).json({
      error: err.message,
      code: err.code,
    });
    return;
  }

  const message = err instanceof Error ? err.message : 'Internal server error';
  logger.error('Unhandled server error', {
    path: req.path,
    method: req.method,
    error: message,
  });

  res.status(500).json({
    error: 'An unexpected server error occurred. Please try again later.',
    code: 'INTERNAL_ERROR',
  });
}
