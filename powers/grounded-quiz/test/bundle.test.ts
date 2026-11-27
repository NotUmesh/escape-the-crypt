import { spawn } from 'node:child_process';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { CHECK_VERSION } from '../src/core-imports';
import { TOOL_DEFINITIONS } from '../src/tools';
import { HUMAN_HEART, POWER_DIR, supportedSampleQuestions } from './support';
import type { Json } from './support';

const BUNDLE = join(POWER_DIR, 'server', 'index.mjs');

interface Session {
  call(name: string, args: Json): Promise<Json>;
  send(method: string, params?: unknown): Promise<Json>;
  stdoutLines: string[];
  finish(): Promise<{ code: number | null; stderr: string }>;
}

function startBundle(): Session {
  const child = spawn(process.execPath, [BUNDLE], { stdio: ['pipe', 'pipe', 'pipe'] });
  const waiting = new Map<number, (message: Json) => void>();
  const stdoutLines: string[] = [];
  let buffer = '';
  let stderr = '';
  let id = 0;
  child.stdout.on('data', (chunk: Buffer) => {
    buffer += chunk.toString('utf8');
    for (let at = buffer.indexOf('\n'); at >= 0; at = buffer.indexOf('\n')) {
      const line = buffer.slice(0, at);
      buffer = buffer.slice(at + 1);
      stdoutLines.push(line);
      const message = JSON.parse(line) as Json;
      waiting.get(Number(message['id']))?.(message);
    }
  });
  child.stderr.on('data', (chunk: Buffer) => {
    stderr += chunk.toString('utf8');
  });
  const send = (method: string, params?: unknown): Promise<Json> =>
    new Promise((resolve) => {
      id += 1;
      waiting.set(id, resolve);
      child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, ...(params === undefined ? {} : { params }) })}\n`);
    });
  return {
    stdoutLines,
    send,
    async call(name, args) {
      const reply = await send('tools/call', { name, arguments: args });
      const content = (reply['result'] as { content: { text: string }[] }).content[0]?.text ?? '{}';
      return JSON.parse(content) as Json;
    },
    finish: () =>
      new Promise((resolve) => {
        child.on('close', (code) => resolve({ code, stderr }));
        child.stdin.end();
      }),
  };
}

describe('the committed bundle (server/index.mjs)', () => {
  it('exists and is a single file of reasonable size', () => {
    expect(existsSync(BUNDLE)).toBe(true);
    expect(statSync(BUNDLE).size).toBeLessThan(2_000_000);
  });

  it('imports nothing but Node readline: no files, no network, no processes', () => {
    const text = readFileSync(BUNDLE, 'utf8');
    const specifiers = [...text.matchAll(/(?:^|\n)\s*import\s+(?:[^'"]*?from\s+)?["']([^"']+)["']/g)].map((m) => m[1]);
    expect(specifiers).toEqual(['node:readline']);
    // Any other built-in module (fs, net, http, child_process, ...) would show up as a "node:" name.
    expect([...new Set([...text.matchAll(/node:[a-z_/]+/g)].map((m) => m[0]))]).toEqual(['node:readline']);
    expect(text).not.toMatch(/\bnew Function\b|\beval\(/);
  });

  it('serves the same tools as the source, so a source change that was not rebuilt is caught', async () => {
    const session = startBundle();
    await session.send('initialize', { protocolVersion: '2025-06-18' });
    const listed = ((await session.send('tools/list'))['result'] as { tools: unknown[] }).tools;
    expect(listed).toEqual(JSON.parse(JSON.stringify(TOOL_DEFINITIONS)));
    await session.finish();
  });

  it('reports the same check version as core, so a core change that was not rebuilt is caught', async () => {
    const session = startBundle();
    await session.send('initialize', { protocolVersion: '2025-06-18' });
    const checks = await session.call('list_checks', {});
    await session.finish();
    expect(checks['checkVersion']).toBe(CHECK_VERSION);
  });

  it('runs the whole flow over stdio on samples/human-heart.txt, writes only protocol messages, and exits when input ends', async () => {
    const session = startBundle();
    const init = await session.send('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'test', version: '0' } });
    expect((init['result'] as Json)['serverInfo']).toEqual({ name: 'grounded-quiz', version: '0.1.0' });
    const prepared = await session.call('prepare_notes', { text: HUMAN_HEART });
    const notesId = String(prepared['notesId']);
    expect(prepared['paragraphCount']).toBe(9);
    const resolved = await session.call('resolve_quote', {
      notesId,
      paragraph: 6,
      quote: 'The valves between the atria and ventricles are called the atrioventricular valves',
    });
    expect(resolved['resolves']).toBe(true);
    const supported = supportedSampleQuestions();
    const quiz = await session.call('check_quiz', { notesId, questions: supported });
    expect(quiz['passes']).toBe(true);
    expect((quiz['summary'] as Json)['total']).toBe(supported.length);
    const { code, stderr } = await session.finish();
    expect(code).toBe(0);
    expect(stderr).toBe('');
    for (const line of session.stdoutLines) expect(() => JSON.parse(line), line.slice(0, 80)).not.toThrow();
  });

  it('never writes notes text anywhere but back to the caller', async () => {
    const session = startBundle();
    await session.send('initialize', { protocolVersion: '2025-06-18' });
    await session.call('prepare_notes', { text: 'A private note about the valves of the heart and nothing else at all.' });
    const { stderr } = await session.finish();
    expect(stderr).toBe('');
  });
});
