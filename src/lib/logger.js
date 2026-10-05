/**
 * Project Nexus - Structured JSON Logger
 */
const LEVELS = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

const currentLevel = process.env.LOG_LEVEL || 'info';

function formatLog(level, message, meta = {}) {
  return JSON.stringify({
    timestamp: new Date().toISOString(),
    level: level.toUpperCase(),
    message,
    ...meta,
  });
}

export const logger = {
  debug(message, meta) {
    if (LEVELS[currentLevel] <= LEVELS.debug) {
      console.debug(formatLog('debug', message, meta));
    }
  },
  info(message, meta) {
    if (LEVELS[currentLevel] <= LEVELS.info) {
      console.log(formatLog('info', message, meta));
    }
  },
  warn(message, meta) {
    if (LEVELS[currentLevel] <= LEVELS.warn) {
      console.warn(formatLog('warn', message, meta));
    }
  },
  error(message, meta) {
    if (LEVELS[currentLevel] <= LEVELS.error) {
      console.error(formatLog('error', message, meta));
    }
  },
};
