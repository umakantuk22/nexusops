/**
 * Project Nexus - Enterprise Environment Configuration & Fail-Safe Secrets Validation
 */
const isProduction = process.env.NODE_ENV === 'production';
const DEFAULT_DEV_SECRET = 'nexus_dev_secret_key_minimum_32_characters_for_security_testing_purpose';

const rawSecret = process.env.JWT_SECRET;

// P0 Security Defense: Fail fast on startup in production if secret is missing or insecure default
if (isProduction && (!rawSecret || rawSecret === DEFAULT_DEV_SECRET || rawSecret.length < 32)) {
  throw new Error(
    'FATAL SECURITY VIOLATION: In production mode (NODE_ENV=production), JWT_SECRET must be an explicit, unique secret of at least 32 characters. Built-in defaults are prohibited.'
  );
}

export const env = {
  NODE_ENV: process.env.NODE_ENV || 'development',
  APP_PORT: parseInt(process.env.APP_PORT || '3000', 10),
  APP_URL: process.env.APP_URL || 'http://localhost:3000',
  ALLOWED_ORIGINS: process.env.ALLOWED_ORIGINS
    ? process.env.ALLOWED_ORIGINS.split(',').map((o) => o.trim())
    : ['http://localhost:3000', 'http://127.0.0.1:3000'],
  JWT_SECRET: rawSecret || DEFAULT_DEV_SECRET,
  JWT_EXPIRES_IN_SECONDS: parseInt(process.env.JWT_EXPIRES_IN_SECONDS || '86400', 10),
  DATABASE_URL: process.env.DATABASE_URL || 'postgresql://nexus_user:nexus_password@localhost:5432/nexus_db?schema=public',
  REDIS_URL: process.env.REDIS_URL || 'redis://localhost:6379',
  LOG_LEVEL: process.env.LOG_LEVEL || 'info',
  MAX_BODY_SIZE_BYTES: 1024 * 1024, // 1 MB default body size limit
  MAX_CSV_SIZE_BYTES: 10 * 1024 * 1024, // 10 MB CSV upload limit
};
