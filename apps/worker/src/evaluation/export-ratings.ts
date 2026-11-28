import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseCassetteFile, type CassetteFile } from '@escape-the-crypt/core';
import { alignGeneration } from './align-generation';
import type { Io } from './cli';
import { parseFlags } from './flags';
import { evaluationPaths, isPlainCsvName, isPlainJsonName, isSafeModelId, type EvalProviderName } from './paths';
import { columnsFor, toCsv, type Row } from './ratings-csv';
import { parseEvaluationResult, type EvaluationResult } from './result-file';

export const EXPORT_USAGE = [
  'Usage (from the repository root):',
  '  pnpm --filter @escape-the-crypt/worker eval export-ratings --result <result.json> [--out <ratings.csv>] [--blind]',
  'Writes one row per accepted or rejected question of a result file, from its cassettes, into the results folder.',
  'Raters fill the rater, verdict (correct, wrong or unsure) and comment columns.',
  '--blind leaves out the result and rejection_reason columns and shuffles the rows, so a rater cannot tell accepted from rejected.',
  'It never overwrites an existing CSV. The CSV holds question text: it is git-ignored, never commit it.',
].join('\n');

/** The cassette folder for the result's provider and model; holdout cassettes only for a holdout result. */
function cassetteDirFor(run: EvaluationResult, repoRoot: string): string | null {
  const provider = run.provider;
  if ((provider !== 'openai' && provider !== 'gemini') || !isSafeModelId(run.modelId)) return null;
  const paths = evaluationPaths(repoRoot);
  const name: EvalProviderName = provider;
  return run.set === 'holdout' ? paths.holdoutCassettesDir(name, run.modelId) : paths.cassettesDirFor(name, run.modelId);
}

function loadCassette(dir: string, note: string): CassetteFile | null {
  const path = join(dir, note.replace(/\.txt$/, '.json'));
  if (!existsSync(path)) return null;
  try {
    const parsed = parseCassetteFile(JSON.parse(readFileSync(path, 'utf8')));
    return parsed.ok ? parsed.value : null;
  } catch {
    return null;
  }
}

const shuffleKey = (runId: string, row: Row): string =>
  createHash('sha256').update(`${runId}|${row['note']}|${row['concept_index']}|${row['role']}`).digest('hex');

/** Returns the exit code. Reads dev cassettes, or holdout ones only when the result file says holdout. */
export async function runExportRatings(argv: readonly string[], repoRoot: string, io: Io): Promise<number> {
  const flags = parseFlags(argv);
  const resultName = flags['result']?.[0];
  const blind = flags['blind'] !== undefined;
  if (resultName === undefined || !isPlainJsonName(resultName)) {
    io.out(EXPORT_USAGE);
    return 1;
  }
  const paths = evaluationPaths(repoRoot);
  const resultPath = join(paths.resultsDir, resultName);
  if (!existsSync(resultPath)) {
    io.out(`Result file not found: ${resultName}`);
    return 1;
  }
  const result = parseEvaluationResult(JSON.parse(readFileSync(resultPath, 'utf8')));
  if (!result.ok) {
    io.out(`Result file does not parse: ${resultName}`);
    return 1;
  }
  const run = result.value;
  const outName = flags['out']?.[0] ?? `${resultName.replace(/\.json$/, '')}-ratings.csv`;
  if (!isPlainCsvName(outName)) {
    io.out(`Not a plain .csv file name: ${outName}`);
    return 1;
  }
  const outPath = join(paths.resultsDir, outName);
  if (existsSync(outPath)) {
    io.out(`${outName} already exists and may hold ratings. Nothing was written; pass --out with another name.`);
    return 1;
  }
  const dir = cassetteDirFor(run, repoRoot);
  if (dir === null) {
    io.out('The result file names a provider or model this tool cannot map to a cassette folder. Nothing was written.');
    return 1;
  }

  const rows: Row[] = [];
  const problems: string[] = [];
  for (const note of run.notes) {
    const cassette = loadCassette(dir, note.note);
    if (cassette === null) {
      problems.push(`${note.note}: no readable cassette`);
      continue;
    }
    const aligned = alignGeneration(note, cassette);
    if (!aligned.ok) {
      problems.push(`${note.note}: ${aligned.reason}`);
      continue;
    }
    for (const c of note.candidates) {
      if (c.result === 'not-reviewed') continue;
      const q = aligned.byConcept.get(c.conceptIndex)?.[c.role];
      if (q === undefined || q === null) continue;
      rows.push({
        run_id: run.runId,
        note: note.note,
        concept_index: String(c.conceptIndex),
        concept_id: c.conceptId,
        role: c.role,
        lock_type: c.lockType,
        result: c.result === 'accepted' ? 'accepted' : 'rejected',
        rejection_reason: c.result === 'code-check-rejected' ? c.checkIds.join(' ') : c.result === 'review-rejected' ? (c.reviewReason ?? '') : '',
        prompt: q.prompt,
        answer: q.answer,
        options: q.options,
        quotes: q.quotes,
        explanation: q.explanation,
      });
    }
  }
  for (const p of problems) io.out(`Skipped ${p}.`);
  if (rows.length === 0) {
    io.out('No rateable questions could be matched to a cassette. Nothing was written.');
    return 1;
  }
  const ordered = blind ? [...rows].sort((a, b) => shuffleKey(run.runId, a).localeCompare(shuffleKey(run.runId, b))) : rows;
  mkdirSync(paths.resultsDir, { recursive: true });
  writeFileSync(outPath, toCsv(columnsFor(blind), ordered));
  io.out(`Wrote ${ordered.length} row(s) to ${outName}${blind ? ' (blind)' : ''}.`);
  if (problems.length > 0) io.out(`${problems.length} note(s) were skipped, so the CSV is incomplete.`);
  return problems.length > 0 ? 2 : 0;
}
