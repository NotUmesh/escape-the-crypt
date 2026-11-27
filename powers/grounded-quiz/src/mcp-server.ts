import { createInterface } from 'node:readline';
import type { Readable, Writable } from 'node:stream';
import { createNotesStore } from './notes-store';
import type { NotesStore } from './notes-store';
import { TOOL_DEFINITIONS, callTool } from './tools';

export const SERVER_NAME = 'grounded-quiz';
export const SERVER_VERSION = '0.1.0';
/** Protocol versions this server answers to. A client asking for another gets the newest one here. */
export const SUPPORTED_PROTOCOLS = ['2024-11-05', '2025-03-26', '2025-06-18'] as const;
const MAX_LINE_CHARS = 2_000_000;

type Id = string | number | null;

interface RpcRequest {
  readonly jsonrpc: '2.0';
  readonly id?: Id;
  readonly method: string;
  readonly params?: unknown;
}

const errorReply = (id: Id, code: number, message: string): string =>
  JSON.stringify({ jsonrpc: '2.0', id, error: { code, message } });
const resultReply = (id: Id, result: unknown): string => JSON.stringify({ jsonrpc: '2.0', id, result });

function isRequest(value: unknown): value is RpcRequest {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const v = value as Record<string, unknown>;
  const idOk = v['id'] === undefined || v['id'] === null || typeof v['id'] === 'string' || typeof v['id'] === 'number';
  return v['jsonrpc'] === '2.0' && typeof v['method'] === 'string' && idOk;
}

function asRecord(value: unknown): Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

export interface McpServer {
  /** One line of input in, at most one line of output back (notifications get none). */
  readonly handleLine: (line: string) => string | undefined;
  readonly store: NotesStore;
}

/** A minimal MCP server over JSON-RPC 2.0: initialize, ping, tools/list, tools/call. It logs nothing. */
export function createMcpServer(store: NotesStore = createNotesStore()): McpServer {
  const ctx = { store };

  function handle(request: RpcRequest): string | undefined {
    const isNotification = request.id === undefined;
    const id: Id = request.id ?? null;
    if (isNotification) return undefined;
    switch (request.method) {
      case 'initialize': {
        const asked = asRecord(request.params)['protocolVersion'];
        const newest = SUPPORTED_PROTOCOLS[SUPPORTED_PROTOCOLS.length - 1];
        const protocolVersion = SUPPORTED_PROTOCOLS.find((v) => v === asked) ?? newest;
        return resultReply(id, {
          protocolVersion,
          capabilities: { tools: {} },
          serverInfo: { name: SERVER_NAME, version: SERVER_VERSION },
        });
      }
      case 'ping':
        return resultReply(id, {});
      case 'tools/list':
        return resultReply(id, { tools: TOOL_DEFINITIONS });
      case 'tools/call': {
        const params = asRecord(request.params);
        const name = params['name'];
        if (typeof name !== 'string') return errorReply(id, -32602, 'Invalid params: "name" must be a string.');
        const outcome = callTool(name, params['arguments'] ?? {}, ctx);
        if (outcome.ok) return resultReply(id, { content: [{ type: 'text', text: JSON.stringify(outcome.value, null, 2) }] });
        return resultReply(id, { isError: true, content: [{ type: 'text', text: JSON.stringify({ error: outcome.error }) }] });
      }
      default:
        return errorReply(id, -32601, `Method not found: ${request.method}`);
    }
  }

  return {
    store,
    handleLine(line) {
      if (line.trim() === '') return undefined;
      if (line.length > MAX_LINE_CHARS) return errorReply(null, -32600, 'Request too large.');
      let parsed: unknown;
      try {
        parsed = JSON.parse(line);
      } catch {
        return errorReply(null, -32700, 'Parse error.');
      }
      if (!isRequest(parsed)) return errorReply(null, -32600, 'Invalid request.');
      return handle(parsed);
    },
  };
}

/** Serves newline-delimited JSON-RPC on the given streams until input ends. Only protocol messages reach `output`. */
export function runStdio(input: Readable, output: Writable, server: McpServer = createMcpServer()): Promise<void> {
  return new Promise((resolve) => {
    const lines = createInterface({ input, crlfDelay: Infinity });
    lines.on('line', (line) => {
      const reply = server.handleLine(line);
      if (reply !== undefined) output.write(`${reply}\n`);
    });
    lines.on('close', () => resolve());
  });
}
