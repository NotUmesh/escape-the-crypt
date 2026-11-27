import { execFileSync, spawnSync } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { checkTasksFormat, formatViolation } from './tasks-format.ts';
import type { TasksRule } from './tasks-format.ts';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

const GOOD = [
  '# Implementation Plan: Example',
  '## Overview',
  'Some text with - [ ] inside a sentence is fine.',
  '## Tasks',
  '- [x] 1. Scaffold',
  '  - [x] 1.1 Create the package',
  '    - _Requirements: 1.1, 2.3_',
  '  - [x]* 1.2 An optional sub-task',
  '- [-] 2. In progress',
  '  - [x] 2.1 Done part',
  '  - [-] 2.2 Working on it',
  '  - [~] 2.3 Queued',
  '  - [ ] 2.4 Not started',
  '    - _Requirements: 4_',
  '- [ ] 3. Later',
  '',
].join('\n');

const rules = (text: string): TasksRule[] => checkTasksFormat(text).map((v) => v.rule);

describe('checkTasksFormat: accepts the repo format', () => {
  it('passes a well-formed file, with every box state and an optional marker', () => {
    expect(checkTasksFormat(GOOD)).toEqual([]);
  });

  it('accepts requirement lines under a task (two spaces), unsorted numbers, and "none"', () => {
    const text = [
      '- [ ] 0. Task',
      '  - _Requirements: 14.1, 14.6, 1.3_',
      '  - [ ] 0.1 Sub',
      '    - _Requirements: none beyond the cassette mechanism itself (test-support)_',
      '',
    ].join('\n');
    expect(checkTasksFormat(text)).toEqual([]);
  });

  it('lets task numbering start at 0 and sub-tasks be added out of order', () => {
    expect(checkTasksFormat(['- [x] 0. A', '  - [x] 0.2 B', '  - [x] 0.1 C', '- [ ] 1. D', ''].join('\n'))).toEqual([]);
  });

  it('passes an empty file', () => {
    expect(checkTasksFormat('')).toEqual([]);
  });

  it('accepts Windows line endings', () => {
    expect(checkTasksFormat(GOOD.replace(/\n/g, '\r\n'))).toEqual([]);
  });
});

describe('checkTasksFormat: names each mistake', () => {
  const wrap = (...lines: string[]): string => `${lines.join('\n')}\n`;
  const cases: ReadonlyArray<readonly [string, string, TasksRule, string]> = [
    ['uppercase X', wrap('- [X] 1. Task'), 'checkbox-syntax', 'lowercase x'],
    ['empty brackets', wrap('- [] 1. Task'), 'checkbox-syntax', 'space between the brackets'],
    ['no space after the box', wrap('- [ ]1. Task'), 'checkbox-syntax', 'one space'],
    ['star bullet', wrap('* [ ] 1. Task'), 'checkbox-syntax', 'start the line with "- "'],
    ['no number', wrap('- [ ] Task without a number'), 'checkbox-syntax', 'give the task a number'],
    ['top number without a dot', wrap('- [ ] 1 Task'), 'checkbox-syntax', 'ends with a dot'],
    ['sub number with a dot', wrap('- [ ] 1. Task', '  - [ ] 1.1. Sub'), 'checkbox-syntax', 'no trailing dot'],
    ['unknown box', wrap('- [?] 1. Task'), 'checkbox-syntax', 'expected'],
    ['one-space indent', wrap('- [ ] 1. Task', ' - [ ] 1.1 Sub'), 'indent', 'exactly two spaces'],
    ['four-space indent', wrap('- [ ] 1. Task', '    - [ ] 1.1 Sub'), 'indent', 'exactly two spaces'],
    ['indented top task', wrap('  - [ ] 1. Task'), 'checkbox-syntax', 'expected'],
    ['duplicate task', wrap('- [ ] 1. A', '- [ ] 2. B', '- [ ] 2. C'), 'duplicate-id', 'task 2 appears twice'],
    ['duplicate sub-task', wrap('- [ ] 1. A', '  - [ ] 1.1 B', '  - [ ] 1.1 C'), 'duplicate-id', 'sub-task 1.1'],
    ['task out of order', wrap('- [ ] 2. A', '- [ ] 1. B'), 'task-order', 'must increase'],
    ['sub-task under the wrong task', wrap('- [ ] 1. A', '  - [ ] 2.1 B'), 'sub-parent', 'not under task 2'],
    ['sub-task before any task', wrap('  - [ ] 1.1 B'), 'sub-parent', 'not under task 1'],
    ['done parent, open child', wrap('- [x] 1. A', '  - [x] 1.1 B', '  - [ ] 1.2 C'), 'parent-complete', '1 of its sub-tasks'],
    ['requirements without the underscore close', wrap('- [ ] 1. A', '  - [ ] 1.1 B', '    - _Requirements: 1.1'), 'requirements-line', 'expected'],
    ['requirements with a semicolon', wrap('- [ ] 1. A', '  - [ ] 1.1 B', '    - _Requirements: 1.1; 2.1_'), 'requirements-line', 'expected'],
    ['requirements at the wrong indent', wrap('- [ ] 1. A', '  - [ ] 1.1 B', '      - _Requirements: 1.1_'), 'requirements-line', 'expected'],
    ['garbled dash', wrap('- [ ] 1. Tasks 1\u00E2\u20AC\u201C10'), 'encoding', 'garbled characters'],
    ['garbled accent', wrap('- [ ] 1. The s\u00C3\u00A9ance board'), 'encoding', 'garbled characters'],
    ['missing final newline', '- [ ] 1. A', 'final-newline', 'end with a newline'],
  ];

  for (const [name, text, rule, hint] of cases) {
    it(`flags ${name}`, () => {
      const found = checkTasksFormat(text);
      const match = found.find((v) => v.rule === rule);
      expect(match, JSON.stringify(found)).toBeDefined();
      expect(match?.message).toContain(hint);
    });
  }

  it('reports the line number, in line order, and formats a readable line', () => {
    const found = checkTasksFormat(wrap('# Title', '- [ ] 1. A', '- [X] 2. B', '  - [ ] 3.1 C'));
    expect(found.map((v) => v.line)).toEqual([3, 4]);
    const first = found[0];
    expect(first && formatViolation('.kiro/specs/x/tasks.md', first)).toBe(
      '.kiro/specs/x/tasks.md:3 [checkbox-syntax] use a lowercase x',
    );
  });

  it('does not flag English text that merely contains a bracket', () => {
    expect(rules(wrap('Notes: see [the plan] and - [ ] here.', '- [ ] 1. A'))).toEqual([]);
  });

  it('does not flag proper accents and dashes', () => {
    expect(rules(wrap('- [ ] 1. Séance board \u2013 rune cipher'))).toEqual([]);
  });
});

describe('the real tasks.md files', () => {
  const specs = join(REPO, '.kiro', 'specs');
  const files = readdirSync(specs, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => join(specs, e.name, 'tasks.md'));

  it('finds the spec task lists', () => {
    expect(files.length).toBeGreaterThanOrEqual(6);
  });

  for (const file of files) {
    it(`${file.slice(REPO.length + 1).split('\\').join('/')} has no format problems other than garbled characters`, () => {
      const found = checkTasksFormat(readFileSync(file, 'utf8')).filter((v) => v.rule !== 'encoding');
      expect(found.map((v) => formatViolation(file, v))).toEqual([]);
    });
  }
});

describe('the command line', () => {
  const script = join(REPO, 'scripts/hooks/check-tasks-format.ts');
  const run = (...args: string[]) => spawnSync(process.execPath, [script, ...args], { cwd: REPO, encoding: 'utf8' });

  it('passes a clean tasks file', () => {
    const result = run('--file', '.kiro/specs/room-play/tasks.md');
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('no problems');
  });

  it('is silent for a file that is not a tasks.md', () => {
    const result = run('--file', 'README.md');
    expect(result.status).toBe(0);
    expect(result.stdout).toBe('');
  });

  it('reads the saved path from the hook payload on stdin', () => {
    const out = execFileSync(process.execPath, [script], {
      cwd: REPO,
      encoding: 'utf8',
      input: JSON.stringify({ file_path: join(REPO, '.kiro/specs/persistence/tasks.md') }),
    });
    expect(out).toContain('1 tasks file(s) checked');
  });
});
