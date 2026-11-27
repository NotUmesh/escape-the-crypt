import type { Server } from 'node:http';
import type { ProviderUsage } from '@escape-the-crypt/core';
import { costOfUsage, makeInterimLedger } from './budget/interim-ledger';
import {
  ALLOWED_LOCK_TYPES,
  GENERATION_TEMPERATURE,
  MAX_OUTPUT_TOKENS,
  PROVIDER_RETRY_LIMIT,
  PROVIDER_TIMEOUT_MS,
  SWEEP_INTERVAL_MS,
  budgetConfigured,
  configuredWorstCaseUsd,
  readConfig,
  type Env,
  type StartupError,
} from './config';
import { createServer } from './http/server';
import type { Logger } from './http/respond';
import { createJobStore } from './jobs/job-store';
import { makeJsonLogger } from './logger';
import { makeOpenAiProvider } from './provider/openai-provider';

export interface StartOptions {
  readonly logger?: Logger;
  /** Epoch-millisecond clock. Defaults to `Date.now`. */
  readonly now?: () => number;
  /** Sweep period. Values above 60 000 are capped, so the sweep always runs at least once a minute. */
  readonly sweepIntervalMs?: number;
}

export interface RunningWorker {
  readonly server: Server;
  /** The port actually bound (useful when `PORT=0`). */
  readonly port: number;
  /** Stops accepting connections, clears the sweep timer and resolves when the server has closed. */
  readonly close: () => Promise<void>;
}

export type StartResult =
  | { readonly ok: true; readonly value: RunningWorker }
  | { readonly ok: false; readonly error: StartupError };

function fail(error: StartupError): StartResult {
  return { ok: false, error };
}

/**
 * Reads the environment, builds the real Provider, Interim_Ledger and JobStore, starts the HTTP
 * server and the sweep timer. Never throws and never exits the process: the caller decides.
 */
export async function start(env: Env, opts: StartOptions = {}): Promise<StartResult> {
  const config = readConfig(env);
  if (!config.ok) return fail(config.error);
  const cfg = config.value;
  const logger = opts.logger ?? makeJsonLogger();
  const now = opts.now ?? Date.now;

  let provider;
  try {
    provider = makeOpenAiProvider({
      apiKey: cfg.apiKey,
      now,
      logger: (event) =>
        logger.info({
          event: 'provider-call',
          stage: event.stage,
          modelId: event.modelId,
          elapsedMs: event.elapsedMs,
          inputTokens: event.inputTokens,
          outputTokens: event.outputTokens,
          outcome: event.outcome,
        }),
    });
  } catch {
    return fail({ kind: 'missing-api-key' });
  }

  const configured = budgetConfigured(cfg);
  const prices = cfg.prices;
  const ledger = makeInterimLedger({
    // A bad price must refuse Jobs the same way a bad budget does.
    dailyBudgetUsd: configured ? cfg.dailyBudgetUsd : undefined,
    prices: prices ?? { inputUsdPerMTok: Number.NaN, outputUsdPerMTok: Number.NaN },
    now,
  });
  const jobStore = createJobStore({ now, jobTtlMs: cfg.jobTtlMs });

  const server = createServer({
    jobStore,
    provider,
    providerName: 'openai',
    ledger,
    pipelineSettings: {
      modelId: cfg.modelId,
      temperature: GENERATION_TEMPERATURE,
      maxOutputTokens: MAX_OUTPUT_TOKENS,
      timeoutMs: PROVIDER_TIMEOUT_MS,
      retryLimit: PROVIDER_RETRY_LIMIT,
      worstCaseUsd: configuredWorstCaseUsd(prices),
      costOf: (usage: ProviderUsage) => (prices === undefined ? Number.POSITIVE_INFINITY : costOfUsage(usage, prices)),
      allowedLockTypes: ALLOWED_LOCK_TYPES,
    },
    webOrigin: cfg.webOrigin,
    now,
    logger,
    healthStatus: () => (configured ? 'ok' : 'budget-not-configured'),
  });

  const listening = await new Promise<boolean>((resolve) => {
    server.once('error', () => resolve(false));
    server.listen(cfg.port, () => resolve(true));
  });
  if (!listening) return fail({ kind: 'listen-failed' });

  const timer = setInterval(
    () => {
      try {
        const counts = jobStore.sweepExpired();
        logger.info({ event: 'sweep', expired: counts.expired, swept: counts.swept });
      } catch (error: unknown) {
        logger.error({ event: 'sweep', errorType: error instanceof Error ? error.constructor.name : typeof error });
      }
    },
    Math.min(opts.sweepIntervalMs ?? SWEEP_INTERVAL_MS, SWEEP_INTERVAL_MS),
  );
  timer.unref();

  if (!configured) logger.info({ event: 'startup', note: 'budget not configured: jobs refused', missing: cfg.warnings.join(',') });

  const address = server.address();
  const port = typeof address === 'object' && address !== null ? address.port : cfg.port;
  logger.info({ event: 'startup', note: 'listening', port, budgetConfigured: configured });

  let closing: Promise<void> | undefined;
  const close = (): Promise<void> => {
    closing ??= new Promise<void>((resolve) => {
      clearInterval(timer);
      server.close(() => resolve());
      server.closeIdleConnections();
    });
    return closing;
  };

  return { ok: true, value: { server, port, close } };
}
