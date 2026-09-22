export type LogLevel = 'debug' | 'info' | 'warn' | 'error'

// Filters log with numeric hierarchy levels
const LEVEL_VALUES: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
}

// On production environment, only info-level messages are printed on stderr
const MIN_LEVEL_VALUE =
  LEVEL_VALUES[process.env.NODE_ENV === 'production' ? 'info' : 'debug']

function log(
  level: LogLevel,
  msg: string,
  meta: Record<string, unknown> = {},
): void {
  if (LEVEL_VALUES[level] < MIN_LEVEL_VALUE) return

  const logPayload = {
    timestamp:
      new Date()
        .toLocaleString('sv-SE', { timeZone: 'Europe/Paris' })
        .replace(' ', 'T') + 'Z',
    level,
    msg,
    ...meta,
  }

  const output = JSON.stringify(logPayload)

  // Errors are printed on stedrr, the rest on stdout
  if (level === 'error') {
    process.stderr.write(output + '\n')
  } else {
    process.stdout.write(output + '\n')
  }
}

/**
 * Logger to print debug, info, warn and error logs
 *
 * @example logger.info('Serveur démarré avec succès')
 * >>> {"timestamp":"2026-09-14T...","level":"info","msg":"Serveur démarré avec succès"}
 * @exemple
 * logger.info('Requête HTTP traitée', {
 *      requestId: 'req-abc123',
 *      durationMs: 42,
 *      path: '/api/auth/me',
 *      status: 200
 * });
 * >>> {"timestamp":"...","level":"info","msg":"Requête HTTP traitée","requestId":"req-abc123","durationMs":42,"path":"/api/auth/me","status":200}
 */
export const logger = {
  debug: (msg: string, meta?: Record<string, unknown>) =>
    log('debug', msg, meta),
  info: (msg: string, meta?: Record<string, unknown>) => log('info', msg, meta),
  warn: (msg: string, meta?: Record<string, unknown>) => log('warn', msg, meta),
  error: (msg: string, meta?: Record<string, unknown>) =>
    log('error', msg, meta),
}
