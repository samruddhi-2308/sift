import pino from 'pino';
import { config } from './config.js';

const isDev = config.NODE_ENV === 'development';

export const logger = pino({
  level: config.LOG_LEVEL,
  transport: isDev
    ? {
        target: 'pino-pretty',
        options: {
          colorize: true,
          translateTime: 'HH:MM:ss.l',
          ignore: 'pid,hostname',
        },
      }
    : undefined,
  base: {
    env: config.NODE_ENV,
  },
  timestamp: pino.stdTimeFunctions.isoTime,
});

export function createLogger(moduleName: string): pino.Logger {
  return logger.child({ module: moduleName });
}
