import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const HOOKS = join(REPO, '.kiro', 'hooks');

interface HookFile {
  readonly version: string;
  readonly hooks: ReadonlyArray<{
    readonly name: string;
    readonly trigger: string;
    readonly matcher?: string;
    readonly action: { readonly type: string; readonly command?: string; readonly timeout?: number };
  }>;
}

function load(id: string): HookFile['hooks'][number] {
  const file = JSON.parse(readFileSync(join(HOOKS, `${id}.json`), 'utf8')) as HookFile;
  expect(file.version).toBe('v1');
  expect(file.hooks).toHaveLength(1);
  const hook = file.hooks[0];
  if (hook === undefined) throw new Error('no hook');
  return hook;
}

const matcherOf = (id: string): RegExp => new RegExp(load(id).matcher ?? '(?!)');
const both = (path: string): string[] => [path, path.replace(/\//g, '\\')];

describe('hook files in .kiro/hooks', () => {
  const ids = readdirSync(HOOKS)
    .filter((name) => name.endsWith('.json'))
    .map((name) => name.slice(0, -'.json'.length));

  it('are the three quick hooks (the old full-suite hook is retired), each a valid v1 save hook', () => {
    expect(ids.sort()).toEqual(['banned-words-on-copy-edit', 'check-tasks-format-on-edit', 'related-core-tests-on-save']);
    for (const id of ids) {
      const hook = load(id);
      expect(hook.trigger, id).toBe('PostFileSave');
      expect(hook.action.type, id).toBe('command');
      expect(hook.matcher, id).toBeTruthy();
      expect(() => new RegExp(hook.matcher ?? ''), id).not.toThrow();
      expect(hook.action.timeout ?? 60, id).toBeLessThanOrEqual(120);
    }
  });

  it('every command names a script that exists', () => {
    for (const id of ids) {
      const command = load(id).action.command ?? '';
      const script = /node (\S+)/.exec(command)?.[1];
      expect(script, id).toBeDefined();
      expect(existsSync(join(REPO, script ?? '')), `${id}: ${script}`).toBe(true);
    }
  });

  it('no hook calls a package test script, so none can run a whole suite', () => {
    for (const id of ids) {
      const command = load(id).action.command ?? '';
      expect(command, id).not.toMatch(/pnpm|npm|vitest|--run/);
      expect(load(id).action.timeout, id).toBeLessThanOrEqual(60);
    }
  });
});

describe('related-core-tests-on-save matcher', () => {
  const re = matcherOf('related-core-tests-on-save');
  it('matches core source and test files, in either slash style', () => {
    for (const path of ['packages/core/src/chunker.ts', 'packages/core/src/runtime/apply.test.ts', 'C:/work/packages/core/src/a.tsx']) {
      for (const variant of both(path)) expect(re.test(variant), variant).toBe(true);
    }
  });
  it('ignores everything else', () => {
    for (const path of ['packages/core/package.json', 'packages/core/README.md', 'apps/web/src/app.tsx', 'apps/worker/src/config.ts', 'packages/core/src/data.json']) {
      for (const variant of both(path)) expect(re.test(variant), variant).toBe(false);
    }
  });
});

describe('check-tasks-format-on-edit matcher', () => {
  const re = matcherOf('check-tasks-format-on-edit');
  it('matches each spec task list', () => {
    for (const path of ['.kiro/specs/room-play/tasks.md', 'C:/work/.kiro/specs/lock-types/tasks.md']) {
      for (const variant of both(path)) expect(re.test(variant), variant).toBe(true);
    }
  });
  it('ignores other spec files and other task files', () => {
    for (const path of ['.kiro/specs/room-play/design.md', '.kiro/specs/room-play/requirements.md', 'docs/tasks.md', '.kiro/specs/tasks.md', '.kiro/specs/x/tasks.meta.json']) {
      for (const variant of both(path)) expect(re.test(variant), variant).toBe(false);
    }
  });
});

describe('banned-words-on-copy-edit matcher', () => {
  const re = matcherOf('banned-words-on-copy-edit');
  it('matches copy files in core and web, and their tests', () => {
    for (const path of [
      'packages/core/src/copy.ts',
      'packages/core/src/copy-room-play.ts',
      'packages/core/src/copy-banned-words.test.ts',
      'apps/web/src/features/share/share-card-copy.ts',
      'packages/core/src/copy-front-of-house.test.ts',
      'C:/work/apps/web/src/features/x/y-copy.ts',
    ]) {
      for (const variant of both(path)) expect(re.test(variant), variant).toBe(true);
    }
  });
  it('ignores files that are not copy files', () => {
    for (const path of ['packages/core/src/chunker.ts', 'packages/core/src/copy.md', 'apps/web/src/app.tsx', 'apps/worker/src/http/copy.ts', 'packages/core/src/copyright.ts.bak']) {
      for (const variant of both(path)) expect(re.test(variant), variant).toBe(false);
    }
  });
});
