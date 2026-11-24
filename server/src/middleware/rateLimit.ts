import rateLimit from 'express-rate-limit';
import { config } from '../config.js';

/**
 * Enforces a strict rate limit of 5 clip generation jobs per IP per hour.
 */
export const createJobRateLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: config.rateLimitMaxPerHour,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: {
    error: 'Rate limit exceeded. You can submit up to 5 clip generation jobs per hour.',
    code: 'RATE_LIMIT_EXCEEDED',
  },
});
