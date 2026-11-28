import { readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { main, type Io } from './cli';
import { parseEvaluationResult } from './result-file';
import { FIXTURE_RESULT, buildFixture, fakeRepoWithFixture } from './ratings-test-support';

const roots: string[] = [];
afterEach(() => {
  for (const r of roots.splice(0)) rmSync(r, { recursive: true, force: true });
});

const fixtureCsv = (name: string): string => readFileSync(new URL(`./test-fixtures/${name}`, import.meta.url), 'utf8');

function repoWith(csvs: Record<string, string>) {
  const r = fakeRepoWithFixture(buildFixture());
  roots.push(r.root);
  for (const [name, text] of Object.entries(csvs)) writeFileSync(join(r.resultsDir, name), text);
  return r;
}
function io(): Io & { lines: string[] } {
  const lines: string[] = [];
  return { lines, out: (l) => void lines.push(l), now: () => 0, date: () => new Date('2026-11-27T12:00:00Z') };
}
const importArgs = (...csv: string[]): string[] => ['import-ratings', '--result', FIXTURE_RESULT, ...csv.flatMap((c) => ['--csv', c])];
const ratingsOf = (dir: string, name = 'fixture-rated.json') => parseEvaluationResult(JSON.parse(readFileSync(join(dir, name), 'utf8')) as unknown);

describe('eval import-ratings, two raters', () => {
  const both = { 'ann.csv': fixtureCsv('rater-ann.csv'), 'bo.csv': fixtureCsv('rater-bo.csv') };

  it('computes Wrong_Accepted and Correct_Rejected per type for each rater', async () => {
    const { root, resultsDir } = repoWith(both);
    const out = io();
    expect(await main(importArgs('ann.csv', 'bo.csv'), {}, root, out)).toBe(0);
    const parsed = ratingsOf(resultsDir);
    if (!parsed.ok) throw new Error('rated file does not parse');
    const ratings = parsed.value.ratings;
    expect(ratings?.raters).toEqual(['Ann', 'Bo']);
    const ann = ratings?.perRater['Ann'];
    expect(ann?.['rune-cipher']).toMatchObject({ accepted: 1, rejected: 1, wrongAcceptedRate: 0, correctRejectedRate: 1 });
    expect(ann?.['seance-board']).toMatchObject({ accepted: 1, acceptedWrong: 1, wrongAcceptedRate: 1, correctRejectedRate: null });
    expect(ann?.['bone-ordering']).toMatchObject({ rejected: 1, rejectedWrong: 1, correctRejectedRate: 0 });
    expect(ann?.['combination-dial']).toMatchObject({ accepted: 1, acceptedUnsure: 1, wrongAcceptedRate: 0, wrongAcceptedRateMax: 1 });
    const bo = ratings?.perRater['Bo'];
    expect(bo?.['seance-board']).toMatchObject({ wrongAcceptedRate: 0 });
    expect(bo?.['bone-ordering']).toMatchObject({ rejectedUnsure: 1, correctRejectedRate: 0, correctRejectedRateMax: 1 });
    expect(ratings?.coverage).toEqual({
      Ann: { rateable: 5, rated: 5, unrated: 0, missing: 0 },
      Bo: { rateable: 5, rated: 5, unrated: 0, missing: 0 },
    });
  });

  it('reports agreement and kappa, lists each disagreement, and rates only agreed questions as consensus', async () => {
    const { root, resultsDir } = repoWith(both);
    await main(importArgs('ann.csv', 'bo.csv'), {}, root, io());
    const parsed = ratingsOf(resultsDir);
    if (!parsed.ok) throw new Error('rated file does not parse');
    const ratings = parsed.value.ratings;
    expect(ratings?.agreement).toMatchObject({ overlap: 5, agreed: 3, agreementRate: 0.6, kappa: 0.4118 });
    expect(ratings?.agreement?.disagreements).toEqual([
      { note: 'dev-77-fixture.txt', conceptIndex: 0, role: 'alternate', lockType: 'seance-board', result: 'accepted', verdicts: { Ann: 'wrong', Bo: 'correct' } },
      { note: 'dev-77-fixture.txt', conceptIndex: 1, role: 'alternate', lockType: 'bone-ordering', result: 'review-rejected', verdicts: { Ann: 'wrong', Bo: 'unsure' } },
    ]);
    // The two disagreements are not averaged in: consensus holds the other three questions only.
    expect(ratings?.consensus?.['seance-board']).toBeUndefined();
    expect(ratings?.consensus?.['bone-ordering']).toBeUndefined();
    expect(ratings?.consensus?.['rune-cipher']).toMatchObject({ accepted: 1, rejected: 1 });
    expect(ratings?.consensus?.['combination-dial']).toMatchObject({ acceptedUnsure: 1 });
  });

  it('writes a new file with the run data unchanged and leaves the original file untouched', async () => {
    const { root, resultsDir } = repoWith(both);
    const before = readFileSync(join(resultsDir, FIXTURE_RESULT), 'utf8');
    await main(importArgs('ann.csv', 'bo.csv'), {}, root, io());
    expect(readFileSync(join(resultsDir, FIXTURE_RESULT), 'utf8')).toBe(before);
    const rated = JSON.parse(readFileSync(join(resultsDir, 'fixture-rated.json'), 'utf8')) as Record<string, unknown>;
    const { ratings, ...runData } = rated;
    expect(ratings).toBeDefined();
    expect(runData).toEqual(JSON.parse(before));
    // A second import never overwrites the first rated file, and a rated file cannot be imported into again.
    await main(importArgs('ann.csv', 'bo.csv'), {}, root, io());
    expect(readdirSync(resultsDir).filter((n) => n.includes('-rated'))).toEqual(['fixture-rated-2.json', 'fixture-rated.json']);
    const again = io();
    expect(await main(['import-ratings', '--result', 'fixture-rated.json', '--csv', 'ann.csv'], {}, root, again)).toBe(1);
    expect(again.lines[0]).toContain('already holds ratings');
  });

  it('keeps question text and rater comments out of the result file', async () => {
    const { root, resultsDir } = repoWith(both);
    await main(importArgs('ann.csv', 'bo.csv'), {}, root, io());
    const text = readFileSync(join(resultsDir, 'fixture-rated.json'), 'utf8');
    for (const leak of ['vaccine', 'immune', 'option b is also arguable', 'on two lines', 'order is not stated']) expect(text).not.toContain(leak);
  });

  it('reads a spreadsheet-saved file: BOM, CRLF, a capitalised verdict', async () => {
    const saved = `\uFEFF${fixtureCsv('rater-ann.csv').replace(/\r?\n/g, '\r\n').replace(',correct,\r\n', ',Correct,\r\n')}`;
    const { root, resultsDir } = repoWith({ 'ann.csv': saved });
    expect(await main(importArgs('ann.csv'), {}, root, io())).toBe(0);
    const parsed = ratingsOf(resultsDir);
    expect(parsed.ok && parsed.value.ratings?.perRater['Ann']?.['rune-cipher']).toMatchObject({ accepted: 1, acceptedCorrect: 1 });
  });
});

describe('eval import-ratings, one rater and coverage', () => {
  it('imports one rater with no agreement section, and counts blank and missing rows', async () => {
    const lines = fixtureCsv('rater-ann.csv').trimEnd().split('\n');
    const partial = [lines[0], lines[1], lines[2]?.replace(',wrong,option b is also arguable', ',,'), lines[3]].join('\n');
    const { root, resultsDir } = repoWith({ 'ann.csv': partial });
    const out = io();
    expect(await main(importArgs('ann.csv'), {}, root, out)).toBe(0);
    expect(out.lines[0]).toBe('Ann: 2 rated, 1 left blank, 2 not in the CSV.');
    const parsed = ratingsOf(resultsDir);
    expect(parsed.ok && parsed.value.ratings?.agreement).toBeNull();
    expect(parsed.ok && parsed.value.ratings?.consensus).toBeNull();
    expect(parsed.ok && parsed.value.ratings?.coverage['Ann']).toEqual({ rateable: 5, rated: 2, unrated: 1, missing: 2 });
  });

  it('falls back to the file name when the rater column is blank', async () => {
    const anon = fixtureCsv('rater-ann.csv').replace(/,Ann,/g, ',,');
    const { root, resultsDir } = repoWith({ 'carol.csv': anon });
    expect(await main(importArgs('carol.csv'), {}, root, io())).toBe(0);
    const parsed = ratingsOf(resultsDir);
    expect(parsed.ok && parsed.value.ratings?.raters).toEqual(['carol']);
  });
});

describe('eval import-ratings stops on any problem and writes nothing', () => {
  const ann = fixtureCsv('rater-ann.csv');

  async function expectRefused(csvs: Record<string, string>, args: string[], message: string): Promise<void> {
    const { root, resultsDir } = repoWith(csvs);
    const before = readdirSync(resultsDir).sort();
    const out = io();
    expect(await main(['import-ratings', '--result', FIXTURE_RESULT, ...args], {}, root, out)).toBe(1);
    expect(out.lines.join('\n')).toContain(message);
    expect(out.lines.at(-1)).toBe('Nothing was written.');
    expect(readdirSync(resultsDir).sort()).toEqual(before);
  }

  it('an invalid verdict', () => expectRefused({ 'a.csv': ann.replace(',wrong,option', ',maybe,option') }, ['--csv', 'a.csv'], 'a.csv row 3: verdict "maybe" is not correct, wrong or unsure'));
  it('a row that is not a question of this run', () => expectRefused({ 'a.csv': ann.replace('7-fixture.txt,3,concept-3', '7-fixture.txt,9,concept-9') }, ['--csv', 'a.csv'], 'not a rateable question of fixture-run'));
  it('a question rated twice', () => expectRefused({ 'a.csv': `${ann}${ann.split('\n')[1]}\n` }, ['--csv', 'a.csv'], 'the same question appears twice'));
  it('a CSV exported from another run', () => expectRefused({ 'a.csv': ann.replace(/fixture-run/g, 'other-run') }, ['--csv', 'a.csv'], 'run_id is other-run, not fixture-run'));
  it('a lock type that disagrees with the result file', () => expectRefused({ 'a.csv': ann.replace('0,concept-0,primary,rune-cipher', '0,concept-0,primary,seance-board') }, ['--csv', 'a.csv'], 'lock_type does not match the result file'));
  it('a missing required column', () => expectRefused({ 'a.csv': ann.replace(',verdict,', ',judgement,') }, ['--csv', 'a.csv'], 'a.csv: missing column(s) verdict'));
  it('two rater names in one file', () => expectRefused({ 'a.csv': ann.replace('Ann,wrong', 'Zed,wrong') }, ['--csv', 'a.csv'], 'more than one rater name (Ann, Zed)'));
  it('the same rater name in both files', () => expectRefused({ 'a.csv': ann, 'b.csv': ann }, ['--csv', 'a.csv', '--csv', 'b.csv'], 'each rater needs a distinct name'));
  it('a quote that never closes', () => expectRefused({ 'a.csv': `${ann}x,"open\n` }, ['--csv', 'a.csv'], 'a quoted cell never closes'));
  it('a missing file', () => expectRefused({}, ['--csv', 'nope.csv'], 'nope.csv: file not found'));

  it('refuses names with folder parts or more than two CSVs', async () => {
    const { root } = repoWith({});
    expect(await main(['import-ratings', '--result', FIXTURE_RESULT, '--csv', '../a.csv'], {}, root, io())).toBe(1);
    expect(await main(['import-ratings', '--result', FIXTURE_RESULT, '--csv', 'a.csv', '--csv', 'b.csv', '--csv', 'c.csv'], {}, root, io())).toBe(1);
    expect(await main(['import-ratings', '--csv', 'a.csv'], {}, root, io())).toBe(1);
  });
});
