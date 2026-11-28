import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { columnsFor, parseCsv, toCsv } from './ratings-csv';

const fixture = (name: string): string => readFileSync(new URL(`./test-fixtures/${name}`, import.meta.url), 'utf8');

describe('parseCsv', () => {
  it('reads a fixture with a quoted cell holding a comma, doubled quotes and a line break', () => {
    const parsed = parseCsv(fixture('rater-bo.csv'));
    expect(parsed?.rows).toHaveLength(5);
    expect(parsed?.rows[1]?.['comment']).toBe('clear, and "quoted"\non two lines');
    expect(parsed?.rows[1]?.['rater']).toBe('Bo');
  });

  it('accepts CRLF line ends and a leading BOM, as a spreadsheet saves them', () => {
    const text = `\uFEFF${fixture('rater-ann.csv').replace(/\r?\n/g, '\r\n')}`;
    const parsed = parseCsv(text);
    expect(parsed?.header[0]).toBe('run_id');
    expect(parsed?.rows).toHaveLength(5);
    expect(parsed?.rows[4]?.['verdict']).toBe('unsure');
  });

  it('skips blank lines, fills short rows with empty cells and refuses a quote that never closes', () => {
    expect(parseCsv('a,b\n1\n\n2,3\n')?.rows).toEqual([{ a: '1', b: '' }, { a: '2', b: '3' }]);
    expect(parseCsv('a,b\n"1,2\n')).toBeNull();
  });
});

describe('toCsv', () => {
  const columns = ['id', 'prompt'];

  it('writes a BOM, CRLF and quotes cells that need it, and parseCsv reads them back', () => {
    const rows = [{ id: '1', prompt: 'a, "b"\nc' }];
    const text = toCsv(columns, rows);
    expect(text.startsWith('\uFEFFid,prompt\r\n')).toBe(true);
    expect(parseCsv(text)?.rows).toEqual(rows);
  });

  it('turns a leading formula character into text so a spreadsheet does not run it', () => {
    const text = toCsv(columns, [{ id: '=1+1', prompt: '+cmd|calc' }, { id: '@SUM(A1)', prompt: '-5' }, { id: 'plain', prompt: 'ok' }]);
    const rows = parseCsv(text)?.rows ?? [];
    expect(rows.map((r) => r['id'])).toEqual(["'=1+1", "'@SUM(A1)", 'plain']);
    expect(rows.map((r) => r['prompt'])).toEqual(["'+cmd|calc", "'-5", 'ok']);
  });

  it('leaves out the outcome columns for a blind export', () => {
    expect(columnsFor(false)).toContain('result');
    expect(columnsFor(false)).toContain('rejection_reason');
    expect(columnsFor(true)).not.toContain('result');
    expect(columnsFor(true)).not.toContain('rejection_reason');
    expect(columnsFor(true).slice(-3)).toEqual(['rater', 'verdict', 'comment']);
  });
});
