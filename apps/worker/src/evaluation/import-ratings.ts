import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Io } from './cli';
import { parseFlags } from './flags';
import { evaluationPaths, isPlainCsvName, isPlainJsonName } from './paths';
import { parseCsv } from './ratings-csv';
import { RatingsSectionSchema, type RatingsSection } from './ratings-section';
import { compareRaters, statsByType, VERDICTS, type RatedItem, type Verdict } from './ratings-stats';
import { parseEvaluationResult, type EvaluationResult } from './result-file';

export const IMPORT_USAGE = [
  'Usage (from the repository root):',
  '  pnpm --filter @escape-the-crypt/worker eval import-ratings --result <result.json> --csv <rater-1.csv> [--csv <rater-2.csv>]',
  'Reads one or two filled rater CSVs from the results folder and writes <result>-rated.json beside the result file,',
  'a copy of the run data plus a ratings section: per lock type Wrong_Accepted and Correct_Rejected, per rater and',
  'where both raters agree, plus agreement, kappa and every disagreement. The original result file is never changed.',
  'Accepted or rejected comes from the result file, not from the CSV. Any problem in a CSV stops the import.',
].join('\n');

const REQUIRED = ['note', 'concept_index', 'role', 'verdict'] as const;
const keyOf = (note: string, conceptIndex: number, role: string): string => `${note}|${conceptIndex}|${role}`;

interface Rateable {
  readonly note: string;
  readonly conceptIndex: number;
  readonly role: 'primary' | 'alternate';
  readonly lockType: string;
  readonly result: string;
  readonly accepted: boolean;
}

/** Every question an exported CSV would hold: all but `not-reviewed`. */
function rateableOf(run: EvaluationResult): Map<string, Rateable> {
  const out = new Map<string, Rateable>();
  for (const note of run.notes) {
    for (const c of note.candidates) {
      if (c.result === 'not-reviewed') continue;
      out.set(keyOf(note.note, c.conceptIndex, c.role), {
        note: note.note,
        conceptIndex: c.conceptIndex,
        role: c.role,
        lockType: c.lockType,
        result: c.result,
        accepted: c.result === 'accepted',
      });
    }
  }
  return out;
}

interface ReadCsv {
  readonly name: string;
  readonly rater: string;
  readonly items: RatedItem[];
  readonly unrated: number;
}

/** One CSV to rated items, or a list of problems. Nothing is dropped silently. */
function readRatings(name: string, text: string, run: EvaluationResult, rateable: Map<string, Rateable>): ReadCsv | string[] {
  const parsed = parseCsv(text);
  if (parsed === null) return [`${name}: a quoted cell never closes`];
  const missing = REQUIRED.filter((c) => !parsed.header.includes(c));
  if (missing.length > 0) return [`${name}: missing column(s) ${missing.join(', ')}`];
  const problems: string[] = [];
  const raters = new Set<string>();
  const seen = new Set<string>();
  const items: RatedItem[] = [];
  let unrated = 0;
  parsed.rows.forEach((row, i) => {
    const where = `${name} row ${i + 2}`;
    const conceptIndex = Number(row['concept_index']);
    const role = row['role'];
    const known = Number.isInteger(conceptIndex) && (role === 'primary' || role === 'alternate') ? rateable.get(keyOf(row['note'] ?? '', conceptIndex, role)) : undefined;
    if (known === undefined) return void problems.push(`${where}: not a rateable question of ${run.runId} (note, concept_index and role must match the export)`);
    if (row['run_id'] !== undefined && row['run_id'] !== '' && row['run_id'] !== run.runId) problems.push(`${where}: run_id is ${row['run_id']}, not ${run.runId}`);
    if (row['lock_type'] !== undefined && row['lock_type'] !== '' && row['lock_type'] !== known.lockType) problems.push(`${where}: lock_type does not match the result file`);
    const key = keyOf(known.note, known.conceptIndex, known.role);
    if (seen.has(key)) return void problems.push(`${where}: the same question appears twice`);
    seen.add(key);
    const rater = (row['rater'] ?? '').trim();
    if (rater !== '') raters.add(rater);
    const verdict = (row['verdict'] ?? '').trim().toLowerCase();
    if (verdict === '') {
      unrated += 1;
      return;
    }
    if (!VERDICTS.includes(verdict as Verdict)) return void problems.push(`${where}: verdict "${verdict}" is not correct, wrong or unsure`);
    items.push({ ...known, key, verdict: verdict as Verdict });
  });
  if (raters.size > 1) problems.push(`${name}: more than one rater name (${[...raters].join(', ')}); use one file per rater`);
  if (problems.length > 0) return problems;
  const rater = [...raters][0] ?? name.replace(/\.csv$/, '');
  return { name, rater, items, unrated };
}

/** Returns the exit code: 0 imported, 1 usage or any problem (nothing written). */
export async function runImportRatings(argv: readonly string[], repoRoot: string, io: Io): Promise<number> {
  const flags = parseFlags(argv);
  const resultName = flags['result']?.[0];
  const csvNames = flags['csv'] ?? [];
  if (resultName === undefined || !isPlainJsonName(resultName) || csvNames.length < 1 || csvNames.length > 2 || !csvNames.every(isPlainCsvName)) {
    io.out(IMPORT_USAGE);
    return 1;
  }
  const paths = evaluationPaths(repoRoot);
  const resultPath = join(paths.resultsDir, resultName);
  if (!existsSync(resultPath)) {
    io.out(`Result file not found: ${resultName}`);
    return 1;
  }
  const raw = JSON.parse(readFileSync(resultPath, 'utf8')) as unknown;
  const result = parseEvaluationResult(raw);
  if (!result.ok) {
    io.out(`Result file does not parse: ${resultName}`);
    return 1;
  }
  const run = result.value;
  if (run.ratings !== undefined) {
    io.out(`${resultName} already holds ratings. Import into the original result file.`);
    return 1;
  }
  const rateable = rateableOf(run);
  const reads: ReadCsv[] = [];
  const problems: string[] = [];
  for (const name of csvNames) {
    const path = join(paths.resultsDir, name);
    if (!existsSync(path)) {
      problems.push(`${name}: file not found`);
      continue;
    }
    const read = readRatings(name, readFileSync(path, 'utf8'), run, rateable);
    if (Array.isArray(read)) problems.push(...read);
    else reads.push(read);
  }
  if (reads.length === 2 && reads[0]?.rater === reads[1]?.rater) problems.push(`both files name the rater "${reads[0]?.rater}"; each rater needs a distinct name`);
  if (problems.length > 0) {
    problems.slice(0, 12).forEach((p) => io.out(p));
    if (problems.length > 12) io.out(`... and ${problems.length - 12} more.`);
    io.out('Nothing was written.');
    return 1;
  }

  const [first, second] = reads;
  if (first === undefined) return 1;
  const comparison = second === undefined ? null : compareRaters({ name: first.rater, items: first.items }, { name: second.rater, items: second.items });
  const section: RatingsSection = RatingsSectionSchema.parse({
    ratingsSchemaVersion: 1,
    importedAt: io.date().toISOString(),
    csvFiles: csvNames,
    raters: reads.map((r) => r.rater),
    coverage: Object.fromEntries(
      reads.map((r) => [r.rater, { rateable: rateable.size, rated: r.items.length, unrated: r.unrated, missing: rateable.size - r.items.length - r.unrated }] as const),
    ),
    perRater: Object.fromEntries(reads.map((r) => [r.rater, statsByType(r.items)] as const)),
    consensus: comparison === null ? null : statsByType(comparison.consensus),
    agreement:
      comparison === null
        ? null
        : { overlap: comparison.overlap, agreed: comparison.agreed, agreementRate: comparison.agreementRate, kappa: comparison.kappa, disagreements: comparison.disagreements },
  });

  // The run data is the file as read, byte for byte in content; only `ratings` is added.
  const merged = { ...(raw as Record<string, unknown>), ratings: section };
  const base = resultName.replace(/\.json$/, '');
  let outName = `${base}-rated.json`;
  for (let n = 2; existsSync(join(paths.resultsDir, outName)); n += 1) outName = `${base}-rated-${n}.json`;
  mkdirSync(paths.resultsDir, { recursive: true });
  writeFileSync(join(paths.resultsDir, outName), `${JSON.stringify(merged, null, 2)}\n`);

  for (const r of reads) {
    const c = section.coverage[r.rater];
    io.out(`${r.rater}: ${c?.rated ?? 0} rated, ${c?.unrated ?? 0} left blank, ${c?.missing ?? 0} not in the CSV.`);
  }
  io.out(JSON.stringify({ perRater: section.perRater, consensus: section.consensus, agreement: section.agreement }, null, 2));
  io.out(`Wrote ${outName}.`);
  return 0;
}
