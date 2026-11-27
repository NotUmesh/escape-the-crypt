import { PassThrough } from 'node:stream';
import { describe, expect, it } from 'vitest';
import { SERVER_NAME, SERVER_VERSION, SUPPORTED_PROTOCOLS, createMcpServer, runStdio } from '../src/mcp-server';
import { HUMAN_HEART } from './support';
import type { Json } from './support';

const request = (id: number | string | null, method: string, params?: unknown): string =>
  JSON.stringify({ jsonrpc: '2.0', id, method, ...(params === undefined ? {} : { params }) });

function reply(server: ReturnType<typeof createMcpServer>, line: string): Json {
  const out = server.handleLine(line);
  if (out === undefined) throw new Error('no reply');
  return JSON.parse(out) as Json;
}

describe('the MCP server', () => {
  it('answers initialize with its name, version and the tools capability', () => {
    const out = reply(createMcpServer(), request(1, 'initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 't', version: '0' } }));
    expect(out).toMatchObject({
      jsonrpc: '2.0',
      id: 1,
      result: { protocolVersion: '2025-06-18', capabilities: { tools: {} }, serverInfo: { name: SERVER_NAME, version: SERVER_VERSION } },
    });
  });

  it('echoes a protocol version it supports and offers its newest to any other', () => {
    for (const version of SUPPORTED_PROTOCOLS) {
      const out = reply(createMcpServer(), request(1, 'initialize', { protocolVersion: version }));
      expect((out['result'] as Json)['protocolVersion']).toBe(version);
    }
    const other = reply(createMcpServer(), request(1, 'initialize', { protocolVersion: '1999-01-01' }));
    expect((other['result'] as Json)['protocolVersion']).toBe('2025-06-18');
    expect((reply(createMcpServer(), request(1, 'initialize'))['result'] as Json)['protocolVersion']).toBe('2025-06-18');
  });

  it('says nothing to a notification, and nothing to a blank line', () => {
    const server = createMcpServer();
    expect(server.handleLine(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }))).toBeUndefined();
    expect(server.handleLine('')).toBeUndefined();
    expect(server.handleLine('   ')).toBeUndefined();
  });

  it('answers ping', () => {
    expect(reply(createMcpServer(), request('abc', 'ping'))).toEqual({ jsonrpc: '2.0', id: 'abc', result: {} });
  });

  it('lists six tools, each with a description and an object input schema', () => {
    const out = reply(createMcpServer(), request(2, 'tools/list'));
    const tools = (out['result'] as { tools: Json[] }).tools;
    expect(tools.map((t) => t['name'])).toEqual(['prepare_notes', 'resolve_quote', 'check_question', 'check_quiz', 'normalise_text', 'list_checks']);
    for (const tool of tools) {
      expect(String(tool['description']).length).toBeGreaterThan(40);
      expect((tool['inputSchema'] as Json)['type']).toBe('object');
    }
  });

  it('runs a tool and returns its result as JSON text', () => {
    const server = createMcpServer();
    const out = reply(server, request(3, 'tools/call', { name: 'prepare_notes', arguments: { text: HUMAN_HEART } }));
    const result = out['result'] as { content: { type: string; text: string }[]; isError?: boolean };
    expect(result.isError).toBeUndefined();
    expect(result.content[0]?.type).toBe('text');
    const value = JSON.parse(result.content[0]?.text ?? '{}') as Json;
    expect(value['paragraphCount']).toBe(9);
    expect(server.store.size).toBe(1);
  });

  it('returns a refusal as an error result, not a protocol error, and keeps no content in it', () => {
    const out = reply(createMcpServer(), request(4, 'tools/call', { name: 'prepare_notes', arguments: { text: '' } }));
    const result = out['result'] as { isError: boolean; content: { text: string }[] };
    expect(result.isError).toBe(true);
    expect(JSON.parse(result.content[0]?.text ?? '{}')).toEqual({ error: { code: 'empty-notes', message: 'The notes are empty.' } });
    expect(out['error']).toBeUndefined();
  });

  it('refuses an unknown tool, and a call with no tool name', () => {
    const server = createMcpServer();
    const unknown = reply(server, request(5, 'tools/call', { name: 'nope', arguments: {} }));
    expect((unknown['result'] as Json)['isError']).toBe(true);
    expect(reply(server, request(6, 'tools/call', {}))['error']).toMatchObject({ code: -32602 });
    expect(reply(server, request(7, 'tools/call'))['error']).toMatchObject({ code: -32602 });
  });

  it('answers an unknown method with method-not-found', () => {
    expect(reply(createMcpServer(), request(8, 'resources/list'))['error']).toMatchObject({ code: -32601 });
  });

  it('answers bad input with the standard errors and an id of null', () => {
    const server = createMcpServer();
    expect(reply(server, '{not json')).toMatchObject({ id: null, error: { code: -32700 } });
    for (const bad of ['[]', '"text"', '42', JSON.stringify({ jsonrpc: '1.0', id: 1, method: 'ping' }), JSON.stringify({ jsonrpc: '2.0', id: {}, method: 'ping' }), JSON.stringify({ jsonrpc: '2.0', id: 1 })]) {
      expect(reply(server, bad), bad).toMatchObject({ id: null, error: { code: -32600 } });
    }
    expect(reply(server, 'x'.repeat(2_000_001))).toMatchObject({ error: { code: -32600 } });
  });

  it('keeps notes between calls so a later call can use the notesId', () => {
    const server = createMcpServer();
    const prepared = reply(server, request(1, 'tools/call', { name: 'prepare_notes', arguments: { text: HUMAN_HEART } }));
    const notesId = (JSON.parse(((prepared['result'] as Json)['content'] as { text: string }[])[0]?.text ?? '{}') as Json)['notesId'];
    const resolved = reply(server, request(2, 'tools/call', { name: 'resolve_quote', arguments: { notesId, paragraph: 9, quote: 'Each heartbeat starts with an electrical signal from the sinoatrial node' } }));
    const value = JSON.parse(((resolved['result'] as Json)['content'] as { text: string }[])[0]?.text ?? '{}') as Json;
    expect(value['resolves']).toBe(true);
  });
});

describe('runStdio', () => {
  it('reads one request per line, writes one reply per request, and finishes when input ends', async () => {
    const input = new PassThrough();
    const output = new PassThrough();
    const written: string[] = [];
    output.on('data', (chunk: Buffer) => written.push(chunk.toString('utf8')));
    const done = runStdio(input, output);
    input.write(`${request(1, 'initialize', { protocolVersion: '2025-06-18' })}\n`);
    input.write(`${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' })}\n`);
    input.write(`${request(2, 'ping')}\n`);
    input.end();
    await done;
    const lines = written.join('').split('\n').filter((l) => l !== '');
    expect(lines).toHaveLength(2);
    expect(lines.map((l) => (JSON.parse(l) as Json)['id'])).toEqual([1, 2]);
  });

  it('handles a request split across chunks and several requests in one chunk', async () => {
    const input = new PassThrough();
    const output = new PassThrough();
    const written: string[] = [];
    output.on('data', (chunk: Buffer) => written.push(chunk.toString('utf8')));
    const done = runStdio(input, output);
    const ping = request(1, 'ping');
    input.write(ping.slice(0, 10));
    input.write(`${ping.slice(10)}\n${request(2, 'ping')}\n`);
    input.end();
    await done;
    expect(written.join('').split('\n').filter((l) => l !== '')).toHaveLength(2);
  });
});
