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
const REQUIREMENT_LIST = String.raw`\d+(?:\.\d+)*(?:, \d+(?:\.\d+)*)*`;
// Two spaces under a top-level task, four under a sub-task. "none ..." is allowed for tasks no requirement covers.
const REQUIREMENTS = new RegExp(String.raw`^ {2}(?: {2})?- _Requirements?: (?:${REQUIREMENT_LIST}|none\b[^_]*)_$`);
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
  let previousTop = -1;
  const openSubs = new Map<number, number>();
  const parentLines = new Map<number, { line: number; state: string }>();

  lines.forEach((line, index) => {
    const lineNo = index + 1;
    if (MOJIBAKE.test(line)) {
      out.push({ line: lineNo, rule: 'encoding', message: 'garbled characters: UTF-8 text saved as Windows-1252 (for example "â€“" for a dash)' });
    }
    if (/_Requirements?/.test(line) && !REQUIREMENTS.test(line)) {
      out.push({ line: lineNo, rule: 'requirements-line', message: 'expected "    - _Requirements: 1.2, 4.1_" (two or four spaces, numbers separated by ", ", closed by an underscore)' });
    }
    if (!LOOKS_LIKE_TASK.test(line)) return;
    const top = TOP.exec(line);
    const sub = SUB.exec(line);
    if (top === null && sub === null) {
      const indentWrong = /^( {1}| {3,})- \[[ x~-]\]\*? \d+(?:\.\d+)? /.exec(line);
      out.push({
        line: lineNo,
        rule: indentWrong === null ? 'checkbox-syntax' : 'indent',
        message: indentWrong === null ? syntaxHint(line) : 'a task starts at column 0 and a sub-task at exactly two spaces',
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
      parentLines.set(id, { line: lineNo, state: top[1] ?? ' ' });
      return;
    }
    if (sub !== null) {
      const parentId = Number(sub[3]);
      const subId = Number(sub[4]);
      const key = `${parentId}.${subId}`;
      if (seen.has(key)) out.push({ line: lineNo, rule: 'duplicate-id', message: `sub-task ${key} appears twice` });
      seen.add(key);
      if (parent === undefined || parent.id !== parentId) {
        out.push({ line: lineNo, rule: 'sub-parent', message: `sub-task ${key} is not under task ${parentId}` });
      }
      if (sub[1] !== 'x' && parent !== undefined && parent.id === parentId) {
        openSubs.set(parentId, (openSubs.get(parentId) ?? 0) + 1);
      }
    }
  });

  for (const [id, open] of openSubs) {
    const info = parentLines.get(id);
    if (info !== undefined && info.state === 'x') {
      out.push({ line: info.line, rule: 'parent-complete', message: `task ${id} is marked done but ${open} of its sub-tasks are not` });
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
