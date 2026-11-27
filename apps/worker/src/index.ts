import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { STARTUP_ERROR_COPY } from './config';
import { makeJsonLogger } from './logger';
import { start } from './start';

export { start } from './start';
export type { RunningWorker, StartOptions, StartResult } from './start';

async function main(): Promise<void> {
  const logger = makeJsonLogger();
  const result = await start(process.env, { logger });
  if (!result.ok) {
    logger.error({ event: 'startup-failed', kind: result.error.kind, message: STARTUP_ERROR_COPY[result.error.kind] });
    process.exit(1);
    return;
  }
  const worker = result.value;
  process.once('SIGTERM', () => {
    logger.info({ event: 'shutdown', signal: 'SIGTERM' });
    void worker.close().then(() => process.exit(0));
  });
}

function runDirectly(): boolean {
  const entry = process.argv[1];
  if (entry === undefined) return false;
  try {
    return realpathSync(entry) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

if (runDirectly()) void main();
