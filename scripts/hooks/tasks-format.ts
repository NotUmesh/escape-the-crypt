export type TasksRule =
  | 'checkbox-syntax'
  | 'indent'
  | 'duplicate-id'
  | 'task-order'
  | 'sub-parent'
  | 'parent-complete'
  | 'requirements-line'
  | 'encoding'
  | 'final-newline';

export interface TasksViolation {
  readonly line: number;
  readonly rule: TasksRule;
  readonly message: string;
}

/**
 * The shape of a Kiro tasks.md as this repo uses it:
 *
 *   - [ ] 3. A top-level task            (column 0, "N.")
 *     - [x] 3.2 A sub-task               (two spaces, "N.M", under task N)
 *       - _Requirements: 1.2, 4.1_       (four spaces, optional)
 *
 * The box holds a space (to do), `x` (done), `-` (in progress) or `~` (queued). A `*` after the box marks
 * an optional task. Text outside task lines (the overview) is not checked.
 */
const LOOKS_LIKE_TASK = /^\s*[-*+]\s*\[/;
const TOP = /^- \[([ x~-])\](\*?) (\d+)\. \S/;
const SUB = /^ {2}- \[([ x~-])\](\*?) (\d+)\.(\d+) \S/;
const LEAF = /^ {4}- \[([ x~-])\](\*?) (\d+)\.(\d+)\.(\d+) \S/;
const REQUIREMENT_LIST = String.raw`\d+(?:\.\d+)*(?:, \d+(?:\.\d+)*)*`;
// Two spaces under a top-level task, four under a sub-task, six under a third-level task.
// "none ..." is allowed for tasks no requirement covers.
const REQUIREMENTS = new RegExp(String.raw`^ {2}(?: {2}){0,2}- _Requirements?: (?:${REQUIREMENT_LIST}|none\b[^_]*)_$`);
// UTF-8 text that was decoded as Windows-1252 shows up as these sequences ("â€“" for an en dash).
const MOJIBAKE = /Ã[\u0080-\u00BF\u0152-\u2122]|â€|Â[\u00A0-\u00BF]/;

function syntaxHint(line: string): string {
  if (/^\s*[-*+]\s*\[X\]/.test(line)) return 'use a lowercase x';
  if (/^\s*[-*+]\s*\[\]/.test(line)) return 'put a space between the brackets: [ ]';
  if (/^\s*[*+]/.test(line)) return 'start the line with "- "';
  if (/^\s*-\s*\[[ x~-]\]\S/.test(line) || /^\s*-\[/.test(line)) return 'leave one space before and after the box';
  if (/^\s*- \[[ x~-]\]\*? (?!\d)/.test(line)) return 'give the task a number: "3." for a task, "3.2" for a sub-task';
  if (/^\s*- \[[ x~-]\]\*? \d+\.\d+\. /.test(line)) return 'a sub-task number has no trailing dot: "3.2"';
  if (/^\s*- \[[ x~-]\]\*? \d+ /.test(line)) return 'a top-level number ends with a dot: "3."';
  return 'expected "- [ ] N. title" or "  - [ ] N.M title"';
}

/** Checks one tasks.md. Pure; returns every problem, in line order. */
export function checkTasksFormat(text: string): TasksViolation[] {
  const out: TasksViolation[] = [];
  const lines = text.split(/\r?\n/);
  const seen = new Set<string>();
  let parent: { id: number; line: number; state: string } | undefined;
  let subParent: { key: string; line: number; state: string } | undefined;
  let previousTop = -1;
  const openChildren = new Map<string, number>();
  const parents = new Map<string, { line: number; state: string }>();

  lines.forEach((line, index) => {
    const lineNo = index + 1;
    if (MOJIBAKE.test(line)) {
      out.push({ line: lineNo, rule: 'encoding', message: 'garbled characters: UTF-8 text saved as Windows-1252 (for example "â€“" for a dash)' });
    }
    if (/_Requirements?/.test(line) && !REQUIREMENTS.test(line)) {
      out.push({ line: lineNo, rule: 'requirements-line', message: 'expected "    - _Requirements: 1.2, 4.1_" (two, four or six spaces, numbers separated by ", ", closed by an underscore)' });
    }
    if (!LOOKS_LIKE_TASK.test(line)) return;
    const top = TOP.exec(line);
    const sub = SUB.exec(line);
    const leaf = LEAF.exec(line);
    if (top === null && sub === null && leaf === null) {
      // A well-formed number at the wrong depth is an indent problem; anything else is a syntax problem.
      const shape = /^( *)- \[[ x~-]\]\*? (?:(\d+\. )|(\d+\.\d+ )|(\d+\.\d+\.\d+ ))/.exec(line);
      const expected = shape === null ? -1 : shape[2] !== undefined ? 0 : shape[3] !== undefined ? 2 : 4;
      const indentWrong = shape !== null && shape[1]?.length !== expected;
      out.push({
        line: lineNo,
        rule: indentWrong ? 'indent' : 'checkbox-syntax',
        message: indentWrong ? 'a task starts at column 0, a sub-task at two spaces and a third-level task at four' : syntaxHint(line),
      });
      return;
    }
    if (top !== null) {
      const id = Number(top[3]);
      if (seen.has(String(id))) out.push({ line: lineNo, rule: 'duplicate-id', message: `task ${id} appears twice` });
      seen.add(String(id));
      if (id <= previousTop) out.push({ line: lineNo, rule: 'task-order', message: `task ${id} comes after task ${previousTop}; numbers must increase` });
      previousTop = Math.max(previousTop, id);
      parent = { id, line: lineNo, state: top[1] ?? ' ' };
      subParent = undefined;
      parents.set(String(id), { line: lineNo, state: top[1] ?? ' ' });
      return;
    }
    if (sub !== null) {
      const parentId = Number(sub[3]);
      const key = `${parentId}.${Number(sub[4])}`;
      if (seen.has(key)) out.push({ line: lineNo, rule: 'duplicate-id', message: `sub-task ${key} appears twice` });
      seen.add(key);
      if (parent === undefined || parent.id !== parentId) {
        out.push({ line: lineNo, rule: 'sub-parent', message: `sub-task ${key} is not under task ${parentId}` });
      } else if (sub[1] !== 'x') {
        openChildren.set(String(parentId), (openChildren.get(String(parentId)) ?? 0) + 1);
      }
      subParent = { key, line: lineNo, state: sub[1] ?? ' ' };
      parents.set(key, { line: lineNo, state: sub[1] ?? ' ' });
      return;
    }
    if (leaf !== null) {
      const parentKey = `${Number(leaf[3])}.${Number(leaf[4])}`;
      const key = `${parentKey}.${Number(leaf[5])}`;
      if (seen.has(key)) out.push({ line: lineNo, rule: 'duplicate-id', message: `task ${key} appears twice` });
      seen.add(key);
      if (subParent === undefined || subParent.key !== parentKey) {
        out.push({ line: lineNo, rule: 'sub-parent', message: `task ${key} is not under sub-task ${parentKey}` });
      } else if (leaf[1] !== 'x') {
        openChildren.set(parentKey, (openChildren.get(parentKey) ?? 0) + 1);
      }
    }
  });

  for (const [key, open] of openChildren) {
    const info = parents.get(key);
    if (info !== undefined && info.state === 'x') {
      out.push({ line: info.line, rule: 'parent-complete', message: `task ${key} is marked done but ${open} of its sub-tasks are not` });
    }
  }
  if (text !== '' && !text.endsWith('\n')) {
    out.push({ line: lines.length, rule: 'final-newline', message: 'the file must end with a newline' });
  }
  return out.sort((a, b) => a.line - b.line);
}

export function formatViolation(file: string, v: TasksViolation): string {
  return `${file}:${v.line} [${v.rule}] ${v.message}`;
}
