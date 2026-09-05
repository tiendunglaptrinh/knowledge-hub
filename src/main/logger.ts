/**
 * Console logger for the main process.
 *
 * Deliberately small: no file rotation, no transport, no dependency. Electron
 * already pipes main-process stdout to the terminal in development and to the
 * platform log in a packaged build, which is enough for a single-user desktop
 * application.
 *
 * The level is read once, lazily, because `loadConfig()` has not run yet at
 * module-evaluation time.
 */

export type LogLevel = 'error' | 'warn' | 'info' | 'debug'

const ORDER: Record<LogLevel, number> = { error: 0, warn: 1, info: 2, debug: 3 }

let threshold: number | null = null

function enabled(level: LogLevel): boolean {
  threshold ??= ORDER[(process.env.KB_LOG_LEVEL as LogLevel) in ORDER
    ? (process.env.KB_LOG_LEVEL as LogLevel)
    : 'info']
  return ORDER[level] <= threshold
}

function stamp(): string {
  return new Date().toISOString().slice(11, 23)
}

function emit(level: LogLevel, message: string): void {
  if (!enabled(level)) return
  const line = `${stamp()} ${level.toUpperCase().padEnd(5)} ${message}`
  if (level === 'error') console.error(line)
  else if (level === 'warn') console.warn(line)
  else console.log(line)
}

export const logger = {
  error: (message: string) => emit('error', message),
  warn: (message: string) => emit('warn', message),
  info: (message: string) => emit('info', message),
  debug: (message: string) => emit('debug', message),
}
