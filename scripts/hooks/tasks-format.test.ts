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

  // Lines 69 to 93 of .kiro/specs/haunting-polish/tasks.md, verbatim: task 4 with its sub-tasks 4.1 and 4.2
  // and the six third-level property tasks 4.2.1 to 4.2.6 that Kiro wrote. The first version of the checker
  // knew two levels only and reported lines 76, 79, 82, 85, 88 and 91 of that file as syntax errors.
  it('accepts the third-level property tasks exactly as Kiro wrote them in haunting-polish/tasks.md', () => {
    const excerpt = [
  "- [ ] 4. Moment_Selector (new file, unmounted)",
  "  - [ ] 4.1 Add `motion-moments.ts` and `motion-moments.test.ts`",
  "    - Export `MotionMoment`, `selectMotionMoments(previous, next, notices)` and `announcementKeyFor(moment)` as in the design. Pure, read-only inputs, no reducer or Event import.",
  "    - Unit tests with fixed notice lists: one test per moment kind, a notice the State does not agree with (dropped), an empty list, `previous === null`, `sealCracked`, `roomCleared` and `escaped` (no moment), two `ghostLaidToRest` in one dispatch (both returned, in order).",
  "    - _Requirements: 5.6, 6.1, 6.2, 6.3, 6.5, 6.6, 6.12_",
  "  - [ ] 4.2 Write the selector properties (`motion-moments.properties.test.ts`)",
  "    - Build runs by folding events through `initial` and `apply` on the shared manifest fixture builder in `packages/core/src/test-support/`, the way `runtime-ghosts-properties.test.ts` does. Add coverage counters so the test fails when no run reaches a ghost, a laid-to-rest or a lit candle.",
  "    - [ ] 4.2.1 Property 1: Moments pair with text",
  "      - **Property 1: Moments pair with text**",
  "      - **Validates: Requirements 6.7, 3.3, 4.3, 5.2**",
  "    - [ ] 4.2.2 Property 2: Order and unrelated notices",
  "      - **Property 2: Order and unrelated notices**",
  "      - **Validates: Requirements 6.8, 6.2**",
  "    - [ ] 4.2.3 Property 3: Rest follows rise",
  "      - **Property 3: Rest follows rise**",
  "      - **Validates: Requirements 6.9, 5.1**",
  "    - [ ] 4.2.4 Property 4: Quiet restore and quiet rejection",
  "      - **Property 4: Quiet restore and quiet rejection**",
  "      - **Validates: Requirements 6.5, 6.6, 3.4, 4.7**",
  "    - [ ] 4.2.5 Property 5: Selection agrees with State",
  "      - **Property 5: Selection agrees with State**",
  "      - **Validates: Requirements 6.3**",
  "    - [ ] 4.2.6 Property 6: No write",
  "      - **Property 6: No write**",
  "      - **Validates: Requirements 6.10, 6.11, 3.8**",
      '',
    ].join('\n');
    expect(checkTasksFormat(excerpt)).toEqual([]);
    // The six lines the old checker rejected are the third-level tasks, at four spaces.
    const thirdLevel = excerpt.split('\n').filter((l) => /^ {4}- \[ \] 4\.2\.\d /.test(l));
    expect(thirdLevel.map((l) => l.slice(0, 20))).toEqual([
      '    - [ ] 4.2.1 Prop',
      '    - [ ] 4.2.2 Prop',
      '    - [ ] 4.2.3 Prop',
      '    - [ ] 4.2.4 Prop',
      '    - [ ] 4.2.5 Prop',
      '    - [ ] 4.2.6 Prop',
    ]);
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

  it('accepts third-level tasks as Kiro writes them for property tests, with requirement lines at every depth', () => {
    const text = [
      '- [ ] 4. Selectors',
      '  - [ ] 4.2 Write the selector properties',
      '    - Build runs by folding events through the reducer.',
      '    - [ ] 4.2.1 Property 1: Moments pair with text',
      '      - **Property 1: Moments pair with text**',
      '      - **Validates: Requirements 6.7, 3.3**',
      '      - _Requirements: 6.7, 3.3_',
      '    - [x] 4.2.2 Property 2',
      '    - _Requirements: 6.8_',
      '  - _Requirements: 5.6_',
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
    ['one-space indent', wrap('- [ ] 1. Task', ' - [ ] 1.1 Sub'), 'indent', 'sub-task at two spaces'],
    ['sub-task at four spaces', wrap('- [ ] 1. Task', '    - [ ] 1.1 Sub'), 'indent', 'third-level task at four'],
    ['third-level task at two spaces', wrap('- [ ] 1. Task', '  - [ ] 1.1 Sub', '  - [ ] 1.1.1 Leaf'), 'indent', 'third-level task at four'],
    ['third-level task at six spaces', wrap('- [ ] 1. Task', '  - [ ] 1.1 Sub', '      - [ ] 1.1.1 Leaf'), 'indent', 'third-level task at four'],
    ['indented top task', wrap('  - [ ] 1. Task'), 'indent', 'starts at column 0'],
    ['duplicate task', wrap('- [ ] 1. A', '- [ ] 2. B', '- [ ] 2. C'), 'duplicate-id', 'task 2 appears twice'],
    ['duplicate sub-task', wrap('- [ ] 1. A', '  - [ ] 1.1 B', '  - [ ] 1.1 C'), 'duplicate-id', 'sub-task 1.1'],
    ['task out of order', wrap('- [ ] 2. A', '- [ ] 1. B'), 'task-order', 'must increase'],
    ['sub-task under the wrong task', wrap('- [ ] 1. A', '  - [ ] 2.1 B'), 'sub-parent', 'not under task 2'],
    ['third-level task under the wrong sub-task', wrap('- [ ] 1. A', '  - [ ] 1.1 B', '  - [ ] 1.2 C', '    - [ ] 1.1.1 D'), 'sub-parent', 'not under sub-task 1.1'],
    ['duplicate third-level task', wrap('- [ ] 1. A', '  - [ ] 1.1 B', '    - [ ] 1.1.1 C', '    - [ ] 1.1.1 D'), 'duplicate-id', 'task 1.1.1 appears twice'],
    ['done sub-task with an open third-level task', wrap('- [ ] 1. A', '  - [x] 1.1 B', '    - [ ] 1.1.1 C'), 'parent-complete', 'task 1.1 is marked done'],
    ['sub-task before any task', wrap('  - [ ] 1.1 B'), 'sub-parent', 'not under task 1'],
    ['done parent, open child', wrap('- [x] 1. A', '  - [x] 1.1 B', '  - [ ] 1.2 C'), 'parent-complete', '1 of its sub-tasks'],
    ['requirements without the underscore close', wrap('- [ ] 1. A', '  - [ ] 1.1 B', '    - _Requirements: 1.1'), 'requirements-line', 'expected'],
    ['requirements with a semicolon', wrap('- [ ] 1. A', '  - [ ] 1.1 B', '    - _Requirements: 1.1; 2.1_'), 'requirements-line', 'expected'],
    ['requirements at the wrong indent', wrap('- [ ] 1. A', '  - [ ] 1.1 B', '        - _Requirements: 1.1_'), 'requirements-line', 'expected'],
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
