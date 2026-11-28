import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { Page, Route } from '@playwright/test';
import { buildHumanHeartSampleCrypt, chunkDocument } from '@escape-the-crypt/core';
import { FAKE_WORKER_ORIGIN } from '../playwright.config';
import type { HumanHeartQuestionsFile, JobBundle, JobErrorResponse, JobFailureKindName } from '@escape-the-crypt/core';
import { ackBody, completedBody as completedStatusBody, failureBody, plainBody } from '../src/test-support/worker-bodies';

/** The origin playwright.config.ts gives the e2e build as VITE_WORKER_URL. Nothing listens there. */
export const WORKER_ORIGIN = FAKE_WORKER_ORIGIN;

const SAMPLES = fileURLToPath(new URL('../../../samples/', import.meta.url));

/** The bundled sample notes, as pasted into the app. */
export const SAMPLE_NOTES = readFileSync(`${SAMPLES}human-heart.txt`, 'utf8');

/** What the fake answers to one `GET /jobs/:id`. */
export type FakeStep =
  | { readonly status: 'queued' | 'running' | 'cancelling' | 'expired' }
  /** `leftOut`: the title of a concept the worker says it left out. Sent only to a client that asks with `?notices=1`. */
  | { readonly status: 'completed'; readonly leftOut?: string }
  | { readonly status: 'failed' | 'cancelled'; readonly failure: JobFailureKindName };

export interface SeenRequest {
  readonly method: string;
  readonly url: string;
  readonly headers: Readonly<Record<string, string>>;
  readonly body: string | null;
}

export interface FakeWorker {
  /** Every request that reached the worker origin, in order (preflights excluded). */
  readonly seen: SeenRequest[];
  /** Number of preflight requests answered. */
  readonly preflights: () => number;
}

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, X-Session-Token, Idempotency-Key, X-Judge-Token',
  'Access-Control-Max-Age': '600',
};

/** The worker's 404 body (sendError). */
const NOT_FOUND = JSON.stringify({ error: 'not-found', message: 'Nothing is here.' } satisfies JobErrorResponse);

/** The first words of a chunk: a quote that is really in it. */
const firstWords = (text: string): string => text.split(/\s+/).slice(0, 8).join(' ');

/** A notice naming `title` as left out, with two real passages of the posted notes. */
function conflictNotices(notesText: string, title: string): NonNullable<JobBundle['notices']> {
  const [, first, second] = chunkDocument({ sourceType: 'paste', text: notesText, originalText: notesText });
  if (first === undefined || second === undefined) throw new Error('the notes need three paragraphs for a conflict notice');
  return {
    excluded: [
      {
        conceptId: 'c-left-out',
        conceptTitle: title,
        source: 'model',
        passages: [
          { chunkId: first.id, quote: firstWords(first.text) },
          { chunkId: second.id, quote: firstWords(second.text) },
        ],
      },
    ],
    sufficiency: null,
  };
}

/** A completed worker response built from the notes text the app posted, so chunk IDs match. */
function completedBody(notesText: string, leftOut?: string): string {
  const file = JSON.parse(readFileSync(`${SAMPLES}questions/human-heart.json`, 'utf8')) as HumanHeartQuestionsFile;
  const built = buildHumanHeartSampleCrypt(notesText, file);
  if (!built.ok) throw new Error(`fake bundle failed: ${built.error.kind}`);
  return JSON.stringify(
    completedStatusBody({ manifest: built.value.manifest, content: built.value.content }, undefined, leftOut === undefined ? undefined : conflictNotices(notesText, leftOut)),
  );
}

/**
 * Answers the worker origin with page.route. `POST /jobs` gives 202; each `GET /jobs/:id` takes
 * the next step (the last step repeats). No real worker or AI provider is involved.
 */
export async function installFakeWorker(
  page: Page,
  steps: readonly FakeStep[],
  options: { readonly judgeCode?: string } = {},
): Promise<FakeWorker> {
  const seen: SeenRequest[] = [];
  let preflightCount = 0;
  let postedNotes = '';
  let getCount = 0;
  const json = (route: Route, status: number, body: string): Promise<void> =>
    route.fulfill({ status, contentType: 'application/json', headers: CORS, body });
  await page.route(`${WORKER_ORIGIN}/**`, async (route) => {
    const request = route.request();
    if (request.method() === 'OPTIONS') {
      preflightCount += 1;
      await route.fulfill({ status: 204, headers: CORS });
      return;
    }
    seen.push({ method: request.method(), url: request.url(), headers: request.headers(), body: request.postData() });
    const path = new URL(request.url()).pathname;
    if (request.method() === 'POST' && path === '/judge/jobs') {
      // Like the worker: no route without a configured code, a refusal for a wrong one.
      if (options.judgeCode === undefined) {
        await json(route, 404, NOT_FOUND);
        return;
      }
      if (request.headers()['x-judge-token'] !== options.judgeCode) {
        await json(route, 403, JSON.stringify({ error: 'judge-access-denied', message: 'That judge access code is not right.' }));
        return;
      }
    }
    if (request.method() === 'POST' && (path === '/jobs' || path === '/judge/jobs')) {
      const parsed: unknown = JSON.parse(request.postData() ?? '{}');
      postedNotes =
        typeof parsed === 'object' && parsed !== null && 'notesText' in parsed && typeof parsed.notesText === 'string'
          ? parsed.notesText
          : '';
      await json(route, 202, JSON.stringify(ackBody('queued')));
      return;
    }
    if (request.method() === 'GET' && path === '/jobs/job-1') {
      const step = steps[Math.min(getCount, steps.length - 1)];
      getCount += 1;
      if (step === undefined) {
        await json(route, 404, NOT_FOUND);
      } else if (step.status === 'completed') {
        // Like the real worker: notices only for a client that asks for them.
        const asked = new URL(request.url()).searchParams.get('notices') === '1';
        await json(route, 200, completedBody(postedNotes, asked ? step.leftOut : undefined));
      } else if (step.status === 'failed' || step.status === 'cancelled') {
        await json(route, 200, JSON.stringify(failureBody(step.status, step.failure)));
      } else {
        await json(route, 200, JSON.stringify(plainBody(step.status)));
      }
      return;
    }
    if (request.method() === 'DELETE' && path.startsWith('/jobs/')) {
      // The worker answers a DELETE with JSON, never 204. A running job goes to cancelling.
      await json(route, 202, JSON.stringify(ackBody('cancelling')));
      return;
    }
    await json(route, 404, NOT_FOUND);
  });
  return { seen, preflights: () => preflightCount };
}
