import { runStdio } from './mcp-server';

// Entry point of the bundled server. stdout carries protocol messages only; nothing is logged.
await runStdio(process.stdin, process.stdout);
