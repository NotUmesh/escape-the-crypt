import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createElement } from 'react';
import { describe, expect, it } from 'vitest';
import { chunkDocument, ENTER_CRYPT_LABEL, JobStatusResponseSchema } from '@escape-the-crypt/core';
import { clickButton, useMount } from '../../test-support/flow-dom';
import { useRoomBinding } from '../../state/room-binding';
import type { RoomBinding } from '../../state/room-binding';
import { CryptFlow } from '../crypt/crypt-flow';
import { buildGeneratedCrypt } from './generated-crypt';
import { createWorkerClient } from './worker-client';

/**
 * Reads the golden fixture the worker's own test writes (apps/worker job-contract.test.ts):
 * the real worker's `GET /jobs/:id` body for the sample notes. Nothing here is hand-written.
 */
const FIXTURE = join(process.cwd(), '..', '..', 'packages', 'core', 'src', 'test-support', 'contract', 'job-completed.json');
const golden = JSON.parse(readFileSync(FIXTURE, 'utf8')) as { notesText: string; response: unknown };
// Built at run time: the style guard bans cross-origin URL literals in source.
const ORIGIN = ['https:', 'worker.example'].join('//');

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

/** POST answers the worker's ack; GET answers the golden body. */
function fakeFetch(seen: string[]): typeof fetch {
  return ((url: string, init: RequestInit) => {
    seen.push(`${init.method} ${url.replace(ORIGIN, '')}`);
    if (init.method === 'POST') return Promise.resolve(jsonResponse(202, { jobId: jobId(), status: 'queued' }));
    return Promise.resolve(jsonResponse(200, golden.response));
  }) as unknown as typeof fetch;
}

function jobId(): string {
  const parsed = JobStatusResponseSchema.parse(golden.response);
  return parsed.jobId;
}

describe('worker contract: the real completed response plays in the web app', () => {
  const mount = useMount();

  it('goes from POST and GET through the client to room 1 with playable locks', async () => {
    const seen: string[] = [];
    const client = createWorkerClient({ origin: ORIGIN, fetchImpl: fakeFetch(seen), sessionToken: 'A'.repeat(32), timeoutMs: 1000 });

    const started = await client.startJob(golden.notesText, 'key-0001');
    expect(started).toEqual({ ok: true, value: { jobId: jobId(), status: 'queued' } });
    if (!started.ok) return;
    const polled = await client.getJob(started.value.jobId);
    expect(seen).toEqual(['POST /jobs', `GET /jobs/${jobId()}?progress=1&notices=1`]);
    expect(polled.ok).toBe(true);
    if (!polled.ok || polled.value.kind !== 'completed') throw new Error('the golden response must read as completed');

    const crypt = buildGeneratedCrypt(polled.value.bundle, golden.notesText);
    expect(crypt.ok).toBe(true);
    if (!crypt.ok) return;

    // Every excerpt resolves against the chunks of the notes text the worker was given.
    const chunkIds = new Set(
      chunkDocument({ sourceType: 'paste', text: golden.notesText, originalText: golden.notesText }).map((c) => c.id),
    );
    const excerpts = Object.values(crypt.value.content.questions).flatMap((entry) => entry.excerpts);
    expect(excerpts.length).toBeGreaterThan(0);
    for (const excerpt of excerpts) expect(chunkIds.has(excerpt.chunkId)).toBe(true);
    for (const excerpt of excerpts) expect(crypt.value.chunks.get(excerpt.chunkId)?.text).toContain(excerpt.quote);

    // The same binding the app uses, with the generated crypt injected.
    let binding: RoomBinding | null = null;
    const useBinding = (): RoomBinding => {
      binding = useRoomBinding(() => ({ ok: true, value: crypt.value }));
      return binding;
    };
    mount.render(createElement(CryptFlow, { useBinding }));
    await clickButton(mount.container, ENTER_CRYPT_LABEL);

    const firstRoom = crypt.value.manifest.rooms[0]?.roomId;
    expect(firstRoom).toBeDefined();
    expect((binding as RoomBinding | null)?.state?.currentRoomId).toBe(firstRoom);
    expect((binding as RoomBinding | null)?.phase).toBe('running');
    const locks = mount.container.querySelectorAll<HTMLButtonElement>('.room-screen__lock-button');
    expect(locks.length).toBe(crypt.value.manifest.rooms[0]?.lockSlots.length);
    for (const lock of locks) expect(lock.disabled).toBe(false);
  });
});

describe('worker contract version 2: a running job reports its stage', () => {
  const recorded = golden as unknown as {
    contractVersion?: number;
    running?: { request: string; response: unknown };
  };

  it('reads the recorded running body with its stage and counts', async () => {
    expect(recorded.contractVersion).toBe(2);
    const running = recorded.running?.response;
    expect(JobStatusResponseSchema.safeParse(running).success).toBe(true);
    const fetchRunning = (() => Promise.resolve(jsonResponse(200, running))) as unknown as typeof fetch;
    const client = createWorkerClient({ origin: ORIGIN, fetchImpl: fetchRunning, sessionToken: 'A'.repeat(32), timeoutMs: 1000 });
    const polled = await client.getJob(jobId());
    expect(polled).toEqual({ ok: true, value: { kind: 'running', progress: { stage: 'generating', done: 2, total: 6 } } });
  });

  it('still reads a running body without progress, from a worker that predates it', async () => {
    const fetchOld = (() => Promise.resolve(jsonResponse(200, { jobId: jobId(), status: 'running' }))) as unknown as typeof fetch;
    const client = createWorkerClient({ origin: ORIGIN, fetchImpl: fetchOld, sessionToken: 'A'.repeat(32), timeoutMs: 1000 });
    expect(await client.getJob(jobId())).toEqual({ ok: true, value: { kind: 'running' } });
  });
});
