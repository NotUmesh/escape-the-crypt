import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { BANNED_COPY_PHRASES } from '../../../packages/core/src/copy';
import { SERVER_VERSION } from '../src/mcp-server';
import { TOOL_DEFINITIONS } from '../src/tools';
import { POWER_DIR } from './support';
import type { Json } from './support';

// The Agent Plugins format that Kiro documents for powers (kiro.dev/docs/powers/create and agent-plugins.org, v1.0.0).
const PLUGIN_SCHEMA = 'https://agent-plugins.org/schemas/1.0.0/plugin.schema.json';
const MCP_SCHEMA = 'https://agent-plugins.org/schemas/1.0.0/mcp.schema.json';
const PLUGIN_KEYS = ['$schema', 'name', 'version', 'description', 'author', 'homepage', 'repository', 'license', 'keywords', 'extensions'];
const STDIO_KEYS = ['type', 'command', 'args', 'env', 'cwd'];

const readJson = (file: string): Json => JSON.parse(readFileSync(join(POWER_DIR, file), 'utf8')) as Json;
const readText = (file: string): string => readFileSync(join(POWER_DIR, file), 'utf8');

describe('plugin.json', () => {
  const plugin = readJson('plugin.json');

  it('uses only the fields the closed schema allows, and has every field Kiro requires', () => {
    for (const key of Object.keys(plugin)) expect(PLUGIN_KEYS, key).toContain(key);
    for (const required of ['$schema', 'name', 'version', 'description', 'author', 'keywords']) expect(plugin, required).toHaveProperty(required);
    expect(plugin['$schema']).toBe(PLUGIN_SCHEMA);
  });

  it('has a valid name, a semantic version equal to the server version, and a described author', () => {
    const name = String(plugin['name']);
    expect(name).toMatch(/^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/);
    expect(name).not.toMatch(/--|\.\./);
    expect(name.length).toBeLessThanOrEqual(64);
    expect(name).toBe('grounded-quiz');
    expect(String(plugin['version'])).toMatch(/^\d+\.\d+\.\d+$/);
    expect(plugin['version']).toBe(SERVER_VERSION);
    const author = plugin['author'] as Json;
    expect(String(author['name']).length).toBeGreaterThan(0);
    for (const key of Object.keys(author)) expect(['name', 'email', 'url']).toContain(key);
  });

  it('has keywords for activation', () => {
    const keywords = plugin['keywords'] as unknown[];
    expect(keywords.length).toBeGreaterThanOrEqual(3);
    for (const k of keywords) expect(typeof k === 'string' && k.length > 0).toBe(true);
    expect(keywords).toContain('quiz');
  });

  it('describes itself in one honest paragraph', () => {
    const description = String(plugin['description']);
    expect(description.length).toBeGreaterThan(40);
    expect(description.length).toBeLessThan(400);
  });
});

describe('mcp.json', () => {
  const mcp = readJson('mcp.json');
  const servers = mcp['mcpServers'] as Record<string, Json>;

  it('is the closed Agent Plugins shape', () => {
    expect(mcp['$schema']).toBe(MCP_SCHEMA);
    for (const key of Object.keys(mcp)) expect(['$schema', 'mcpServers']).toContain(key);
    expect(Object.keys(servers)).toEqual(['grounded-quiz']);
  });

  it('declares a stdio server that runs the bundled file, with no secrets', () => {
    const server = servers['grounded-quiz'] as Json;
    for (const key of Object.keys(server)) expect(STDIO_KEYS).toContain(key);
    expect(server['type']).toBe('stdio');
    expect(server['command']).toBe('node');
    expect(String(server['command'])).not.toMatch(/\s/);
    expect(server['args']).toEqual(['${PLUGIN_ROOT}/server/index.mjs']);
    expect(server).not.toHaveProperty('env');
    expect(existsSync(join(POWER_DIR, 'server', 'index.mjs'))).toBe(true);
  });
});

describe('skills', () => {
  const skillsDir = join(POWER_DIR, 'skills');
  const names = readdirSync(skillsDir).filter((n) => statSync(join(skillsDir, n)).isDirectory());

  it('has one skill, grounded-quiz', () => {
    expect(names).toEqual(['grounded-quiz']);
  });

  for (const name of names) {
    it(`${name}/SKILL.md has front matter whose name matches the folder`, () => {
      const text = readFileSync(join(skillsDir, name, 'SKILL.md'), 'utf8');
      const front = /^---\n([\s\S]*?)\n---\n/.exec(text)?.[1] ?? '';
      expect(/^name: (.+)$/m.exec(front)?.[1]).toBe(name);
      expect((/^description: (.+)$/m.exec(front)?.[1] ?? '').length).toBeGreaterThan(40);
      expect(name).toMatch(/^[a-z0-9-]+$/);
    });
  }
});

describe('the documents describe the tools that exist', () => {
  it('README, SKILL.md and the tool list agree on every tool name', () => {
    const readme = readText('README.md');
    const skill = readText('skills/grounded-quiz/SKILL.md');
    expect(TOOL_DEFINITIONS.map((t) => t.name)).toHaveLength(6);
    for (const tool of TOOL_DEFINITIONS) {
      expect(readme, tool.name).toContain(`\`${tool.name}\``);
      expect(skill, tool.name).toContain(`\`${tool.name}\``);
    }
    expect(new Set(TOOL_DEFINITIONS.map((t) => t.name)).size).toBe(TOOL_DEFINITIONS.length);
  });

  it('every file the README links to exists', () => {
    const readme = readText('README.md');
    for (const match of readme.matchAll(/\]\(((?!https?:)[^)#]+)\)/g)) {
      expect(existsSync(join(POWER_DIR, match[1] ?? '')), match[1]).toBe(true);
    }
  });
});

describe('wording', () => {
  const LEARNING_GAIN_CLAIMS = ['learn faster', 'learn more', 'improve your', 'better grades', 'higher grades', 'retention', 'remember more', 'boost your'];
  const FORBIDDEN = [...BANNED_COPY_PHRASES, ...LEARNING_GAIN_CLAIMS];
  const files = [
    'README.md',
    'skills/grounded-quiz/SKILL.md',
    'skills/grounded-quiz/references/question-formats.md',
    'skills/grounded-quiz/references/worked-example.md',
    'plugin.json',
  ];

  for (const file of files) {
    it(`${file} uses no banned wording and makes no learning-gain claim`, () => {
      const lower = readText(file).toLowerCase();
      expect(FORBIDDEN.filter((term) => lower.includes(term.toLowerCase()))).toEqual([]);
    });
  }

  it('the tool descriptions and the check advice use none either', () => {
    const lower = JSON.stringify(TOOL_DEFINITIONS).toLowerCase();
    expect(FORBIDDEN.filter((term) => lower.includes(term.toLowerCase()))).toEqual([]);
  });
});
