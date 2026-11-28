import dotenv from 'dotenv';

dotenv.config();

export interface ServerConfig {
  port: number;
  appUrl: string;
  allowedOrigins: string[];
  redisUrl: string;
  claudeApiKey: string;
  claudeModel: string;
  openaiApiKey: string;
  cloudinaryCloudName: string;
  cloudinaryApiKey: string;
  cloudinaryApiSecret: string;
  ytdlpCookiesPath: string;
  ytdlpCookiesB64: string;
  ytdlpProxy: string;
  googleClientId: string;
  googleClientSecret: string;
  metaAppId: string;
  metaAppSecret: string;
  maxVideoDurationSeconds: number;
  rateLimitMaxPerHour: number;
}

function parseAllowedOrigins(raw: string | undefined): string[] {
  const value = raw?.trim() || 'http://localhost:5173,http://localhost:3000';
  return value
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
}

export const config: ServerConfig = {
  port: Number.parseInt(process.env.PORT ?? '4000', 10) || 4000,
  appUrl: (process.env.APP_URL?.trim() ?? '').replace(/\/+$/, ''),
  allowedOrigins: parseAllowedOrigins(process.env.ALLOWED_ORIGIN),
  redisUrl: process.env.REDIS_URL?.trim() ?? '',
  claudeApiKey: process.env.CLAUDE_API_KEY?.trim() ?? '',
  claudeModel: process.env.CLAUDE_MODEL?.trim() || 'claude-sonnet-4-20250514',
  openaiApiKey: process.env.OPENAI_API_KEY?.trim() ?? '',
  cloudinaryCloudName: process.env.CLOUDINARY_CLOUD_NAME?.trim() ?? '',
  cloudinaryApiKey: process.env.CLOUDINARY_API_KEY?.trim() ?? '',
  cloudinaryApiSecret: process.env.CLOUDINARY_API_SECRET?.trim() ?? '',
  ytdlpCookiesPath: process.env.YTDLP_COOKIES_PATH?.trim() ?? '',
  ytdlpCookiesB64: process.env.YTDLP_COOKIES_B64?.trim() ?? '',
  ytdlpProxy: process.env.YTDLP_PROXY?.trim() ?? '',
  googleClientId: process.env.GOOGLE_CLIENT_ID?.trim() ?? '',
  googleClientSecret: process.env.GOOGLE_CLIENT_SECRET?.trim() ?? '',
  metaAppId: process.env.META_APP_ID?.trim() ?? '',
  metaAppSecret: process.env.META_APP_SECRET?.trim() ?? '',
  maxVideoDurationSeconds:
    (Number.parseInt(process.env.MAX_VIDEO_DURATION_MINUTES ?? '360', 10) || 360) * 60, // 360 minutes (6 hours) default cap
  rateLimitMaxPerHour: 5,
};
