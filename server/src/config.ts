import dotenv from 'dotenv';

dotenv.config();

export interface ServerConfig {
  port: number;
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
  maxVideoDurationSeconds: 60 * 60, // 60 minutes hard cap
  rateLimitMaxPerHour: 5,
};
