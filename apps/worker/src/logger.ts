import type { LogFields, Logger } from './http/respond';

/** One JSON object per line on stdout. Events only: callers pass counts, timings and closed-set names. */
export function makeJsonLogger(write: (line: string) => void = (line) => process.stdout.write(`${line}\n`)): Logger {
  const emit = (level: 'info' | 'error', fields: LogFields): void => {
    try {
      write(JSON.stringify({ level, ...fields }));
    } catch {
      // Logging must never take the process down.
    }
  };
  return { info: (fields) => emit('info', fields), error: (fields) => emit('error', fields) };
}
