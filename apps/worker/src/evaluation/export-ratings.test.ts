import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { main, type Io } from './cli';
import { evaluationPaths } from './paths';
import { parseCsv } from './ratings-csv';
import { FIXTURE_RESULT, RUNE_Q, SEANCE_Q, buildFixture, fakeRepoWithFixture } from './ratings-test-support';

const roots: string[] = [];
afterEach(() => {
  for (const r of roots.splice(0)) rmSync(r, { recursive: true, force: true });
});

function repo(fixture = buildFixture()) {
  const r = fakeRepoWithFixture(fixture);
  roots.push(r.root);
  return r;
}
function io(): Io & { lines: string[] } {
  const lines: string[] = [];
  return { lines, out: (l) => void lines.push(l), now: () => 0, date: () => new Date('2026-11-27T12:00:00Z') };
}
const exportArgs = (...extra: string[]): string[] => ['export-ratings', '--result', FIXTURE_RESULT, ...extra];
const readCsv = (dir: string, name: string) => parseCsv(readFileSync(join(dir, name), 'utf8'));

describe('eval export-ratings', () => {
  it('--with-results writes one row per accepted or rejected question, with blank rater columns, and skips not-reviewed', async () => {
    const { root, resultsDir } = repo();
    const out = io();
    expect(await main(exportArgs('--with-results'), {}, root, out)).toBe(0);
    expect(out.lines).toEqual(['Wrote 5 row(s) to fixture-ratings.csv (with results: not for raters).']);
    const text = readFileSync(join(resultsDir, 'fixture-ratings.csv'), 'utf8');
    expect(text.startsWith('\uFEFFrun_id,note,concept_index,concept_id,role,lock_type,result,rejection_reason,prompt,answer,options,quotes,explanation,rater,verdict,comment')).toBe(true);
    const rows = readCsv(resultsDir, 'fixture-ratings.csv')?.rows ?? [];
    expect(rows.map((r) => [r['concept_index'], r['role'], r['lock_type'], r['result'], r['rejection_reason']])).toEqual([
      ['0', 'primary', 'rune-cipher', 'accepted', ''],
      ['0', 'alternate', 'seance-board', 'accepted', ''],
      ['1', 'primary', 'rune-cipher', 'rejected', 'negative-question'],
      ['1', 'alternate', 'bone-ordering', 'rejected', 'answer-mismatch'],
      ['3', 'primary', 'combination-dial', 'accepted', ''],
    ]);
    expect(rows.every((r) => r['rater'] === '' && r['verdict'] === '' && r['comment'] === '' && r['run_id'] === 'fixture-run')).toBe(true);
  });

  it('shows each type as a rater needs it: answer key, options with labels, quotes, order', async () => {
    const { root, resultsDir } = repo();
    await main(exportArgs('--with-results'), {}, root, io());
    const rows = readCsv(resultsDir, 'fixture-ratings.csv')?.rows ?? [];
    expect(rows[0]).toMatchObject({ prompt: RUNE_Q.prompt, answer: 'vaccine / a vaccine', quotes: 'A vaccine trains the immune system.' });
    expect(rows[1]?.['answer']).toBe('a: Vaccines train the immune system');
    expect(rows[1]?.['options']).toBe('a: Vaccines train the immune system (supported) | b: Vaccines cure every disease (contradicted) | c: Vaccines are antibiotics (contradicted)');
    expect(rows[1]?.['quotes']).toContain('[b] Vaccines prevent some diseases.');
    expect(rows[3]?.['answer']).toBe('Exposure → Response → Memory');
    expect(rows[4]?.['answer']).toBe('2 doses');
  });

  it('holds nothing but question text, ids and verdict columns: no other notes text, no cassette-only fields', async () => {
    const { root, resultsDir } = repo();
    await main(exportArgs(), {}, root, io());
    const text = readFileSync(join(resultsDir, 'fixture-ratings.csv'), 'utf8');
    expect(text).not.toContain('Some notes.');
    expect(text).not.toContain('justification');
    expect(text).not.toContain('chunkId');
  });

  it('survives a prompt with a line break and neutralises a formula prompt', async () => {
    const { root, resultsDir } = repo(buildFixture({ gen0Primary: { ...RUNE_Q, prompt: '=HYPERLINK("x")\nsecond line' } }));
    await main(exportArgs('--with-results'), {}, root, io());
    expect(readCsv(resultsDir, 'fixture-ratings.csv')?.rows[0]?.['prompt']).toBe('\'=HYPERLINK("x")\nsecond line');
  });

  it('is blind by default: no outcome columns, and the same rows shuffled in a repeatable order', async () => {
    const { root, resultsDir } = repo();
    const out = io();
    expect(await main(exportArgs('--out', 'b1.csv'), {}, root, out)).toBe(0);
    expect(out.lines).toEqual(['Wrote 5 row(s) to b1.csv (blind).']);
    expect(await main(exportArgs('--out', 'b2.csv'), {}, root, io())).toBe(0);
    // The plain default file never says which questions were rejected, anywhere in it.
    const text = readFileSync(join(resultsDir, 'b1.csv'), 'utf8');
    for (const leak of ['rejected', 'accepted', 'negative-question', 'answer-mismatch']) expect(text).not.toContain(leak);
    const first = readCsv(resultsDir, 'b1.csv');
    expect(first?.header).not.toContain('result');
    expect(first?.header).not.toContain('rejection_reason');
    expect(readFileSync(join(resultsDir, 'b1.csv'), 'utf8')).toBe(readFileSync(join(resultsDir, 'b2.csv'), 'utf8'));
    const keys = (first?.rows ?? []).map((r) => `${r['concept_index']}${r['role']}`);
    expect([...keys].sort()).toEqual(['0alternate', '0primary', '1alternate', '1primary', '3primary']);
    expect(keys).not.toEqual(['0primary', '0alternate', '1primary', '1alternate', '3primary']);
  });

  it('never overwrites an existing CSV, which may hold a rater\'s work', async () => {
    const { root, resultsDir } = repo();
    writeFileSync(join(resultsDir, 'fixture-ratings.csv'), 'rater work');
    const out = io();
    expect(await main(exportArgs(), {}, root, out)).toBe(1);
    expect(out.lines[0]).toContain('already exists');
    expect(readFileSync(join(resultsDir, 'fixture-ratings.csv'), 'utf8')).toBe('rater work');
  });

  it('refuses a note whose cassette does not line up, rather than showing raters the wrong question', async () => {
    const fixture = buildFixture();
    const wrong = { ...fixture, cassette: { ...fixture.cassette, entries: fixture.cassette.entries.filter((e) => e !== fixture.cassette.entries[3]) } };
    const { root, resultsDir } = repo(wrong);
    const out = io();
    expect(await main(exportArgs(), {}, root, out)).toBe(1);
    expect(out.lines[0]).toContain('4 concept(s) generated but 3 generation reply(ies) found');
    expect(existsSync(join(resultsDir, 'fixture-ratings.csv'))).toBe(false);
  });

  it('refuses a candidate whose lock type differs from the cassette, and exits 2 for a partial export', async () => {
    const fixture = buildFixture();
    // Same digest, different content: concept 1 now holds a séance question, but the result says rune + bone.
    const entries = fixture.cassette.entries.map((e, i) =>
      i === 2 ? { ...e, response: { ...e.response, json: { justification: 'x', primary: SEANCE_Q, alternate: null } } } : e,
    );
    const { root } = repo({ ...fixture, cassette: { ...fixture.cassette, entries } });
    const out = io();
    expect(await main(exportArgs(), {}, root, out)).toBe(1);
    expect(out.lines[0]).toBe('Skipped dev-77-fixture.txt: concept 1 primary does not match the cassette (expected rune-cipher).');
  });

  it('exits 2 when some notes export and others cannot', async () => {
    const fixture = buildFixture();
    const note = fixture.result.notes[0]!;
    const result = { ...fixture.result, notes: [note, { ...note, note: 'dev-78-missing.txt' }] };
    const { root, resultsDir } = repo({ ...fixture, result });
    const out = io();
    expect(await main(exportArgs(), {}, root, out)).toBe(2);
    expect(out.lines).toContain('Skipped dev-78-missing.txt: no readable cassette.');
    expect(readCsv(resultsDir, 'fixture-ratings.csv')?.rows).toHaveLength(5);
  });

  it('takes cassettes from the folder of the result\'s own set: a holdout result reads holdout cassettes, never dev ones', async () => {
    const fixture = buildFixture();
    const { root, resultsDir } = repo({ ...fixture, result: { ...fixture.result, set: 'holdout' as const } });
    // The dev cassette is there, but a holdout result must not use it.
    expect(await main(exportArgs(), {}, root, io())).toBe(1);
    const holdoutDir = evaluationPaths(root).holdoutCassettesDir('openai', 'gpt-fixture');
    mkdirSync(holdoutDir, { recursive: true });
    writeFileSync(join(holdoutDir, 'dev-77-fixture.json'), JSON.stringify(fixture.cassette));
    expect(await main(exportArgs(), {}, root, io())).toBe(0);
    expect(readCsv(resultsDir, 'fixture-ratings.csv')?.rows).toHaveLength(5);
  });

  it('refuses a result whose model ID could not be a folder name', async () => {
    const fixture = buildFixture();
    const { root } = repo({ ...fixture, result: { ...fixture.result, modelId: '../../etc' } });
    const out = io();
    expect(await main(exportArgs(), {}, root, out)).toBe(1);
    expect(out.lines[0]).toContain('cannot map to a cassette folder');
  });

  it('writes only inside the results folder, and rejects a result or output name with folder parts', async () => {
    const { root } = repo();
    expect(await main(['export-ratings', '--result', '../x.json'], {}, root, io())).toBe(1);
    expect(await main(exportArgs('--out', '../escape.csv'), {}, root, io())).toBe(1);
    expect(existsSync(join(root, 'escape.csv'))).toBe(false);
  });
});
