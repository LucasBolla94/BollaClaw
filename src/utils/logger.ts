import * as winston from 'winston';
import * as path from 'path';
import * as fs from 'fs';
import { config } from './config';

// Ensure logs directory exists
if (!fs.existsSync(config.paths.logs)) {
  fs.mkdirSync(config.paths.logs, { recursive: true });
}

const logFormat = winston.format.combine(
  winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
  winston.format.errors({ stack: true }),
  winston.format.printf(({ timestamp, level, message, ...meta }) => {
    const metaStr = Object.keys(meta).length ? ` ${JSON.stringify(meta)}` : '';
    return `[${timestamp}] [${level.toUpperCase()}] ${message}${metaStr}`;
  })
);

export const logger = winston.createLogger({
  level: config.logLevel,
  format: logFormat,
  transports: [
    new winston.transports.Console({
      format: winston.format.combine(winston.format.colorize(), logFormat),
    }),
    new winston.transports.File({
      filename: path.join(config.paths.logs, 'error.log'),
      level: 'error',
    }),
    new winston.transports.File({
      filename: path.join(config.paths.logs, 'combined.log'),
      maxsize: 5 * 1024 * 1024, // 5MB
      maxFiles: 3,
    }),
  ],
});

// In-memory log buffer for admin panel (last 200 entries)
export const logBuffer: Array<{ timestamp: string; level: string; message: string }> = [];

logger.on('data', (chunk) => {
  // This is a hack; we tap into the stream for the buffer
});

// Monkey-patch to capture logs for admin panel
const originalLog = logger.log.bind(logger);
export function captureLog(level: string, message: string): void {
  const entry = {
    timestamp: new Date().toISOString(),
    level,
    message,
  };
  logBuffer.push(entry);
  if (logBuffer.length > 200) logBuffer.shift();
}
