import type { Server } from 'node:http';
import type { ProviderUsage } from '@escape-the-crypt/core';
import { costOfUsage, makeInterimLedger } from './budget/interim-ledger';
import {
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
import { judgeAccessFromEnv, judgeAccessStatus } from './http/judge-access';
import { createServer } from './http/server';
import type { Logger } from './http/respond';
import { createJobStore } from './jobs/job-store';
import { makeJsonLogger } from './logger';
import { makeGeminiProvider } from './provider/gemini-provider';
import { makeOpenAiProvider, type ProviderLogEvent } from './provider/openai-provider';

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

  const providerLog = (event: ProviderLogEvent): void =>
    logger.info({
      event: 'provider-call',
      provider: cfg.provider,
      stage: event.stage,
      modelId: event.modelId,
      elapsedMs: event.elapsedMs,
      inputTokens: event.inputTokens,
      outputTokens: event.outputTokens,
      outcome: event.outcome,
    });
  // Switching is manual (the PROVIDER env var); there is no automatic failover between providers.
  let provider;
  try {
    provider =
      cfg.provider === 'gemini'
        ? makeGeminiProvider({ apiKey: cfg.apiKey, now, logger: providerLog })
        : makeOpenAiProvider({ apiKey: cfg.apiKey, now, logger: providerLog });
  } catch {
    return fail({ kind: cfg.provider === 'gemini' ? 'missing-gemini-api-key' : 'missing-api-key' });
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
  // The judge code is read here and only its hash is kept; it is never logged or put in config.
  const judge = judgeAccessFromEnv(env['JUDGE_ACCESS_TOKEN']);

  const server = createServer({
    jobStore,
    provider,
    providerName: cfg.provider,
    ledger,
    pipelineSettings: {
      modelId: cfg.modelId,
      temperature: GENERATION_TEMPERATURE,
      maxOutputTokens: MAX_OUTPUT_TOKENS,
      timeoutMs: PROVIDER_TIMEOUT_MS,
      retryLimit: PROVIDER_RETRY_LIMIT,
      worstCaseUsd: configuredWorstCaseUsd(prices),
      costOf: (usage: ProviderUsage) => (prices === undefined ? Number.POSITIVE_INFINITY : costOfUsage(usage, prices)),
      allowedLockTypes: cfg.allowedLockTypes,
    },
    webOrigin: cfg.webOrigin,
    now,
    logger,
    healthStatus: () => (configured ? 'ok' : 'budget-not-configured'),
    judge,
    trustedProxyHops: cfg.trustedProxyHops,
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
  // Whether POST /judge/jobs is on. The status names the rule only: never the code or its length.
  logger.info({ event: 'startup', note: 'judge access', ...judgeAccessStatus(env['JUDGE_ACCESS_TOKEN']) });

  const address = server.address();
  const port = typeof address === 'object' && address !== null ? address.port : cfg.port;
  logger.info({
    event: 'startup',
    note: 'listening',
    port,
    provider: cfg.provider,
    budgetConfigured: configured,
    trustedProxyHops: cfg.trustedProxyHops,
    enabledLockTypeCount: cfg.allowedLockTypes.length,
    disabledLockTypes: cfg.disabledLockTypes.join(','),
  });

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
