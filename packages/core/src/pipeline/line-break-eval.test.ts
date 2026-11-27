import { describe, expect, it } from 'vitest';
import {
  NO_ARTIFACTS,
  addArtifacts,
  collectStrings,
  countLineBreakArtifacts,
  type LineBreakArtifacts,
} from '../test-support/line-break-artifacts';
import { buildConceptExtractionUserMessage } from './concept-extraction-prompt';
import { prepareDocument } from './prepare-input';
// Replays only recorded or hand-written material: dev notes, dev gold labels and the one
// cassette in the repo. No provider is called. Reads eval/dev only.
const [fsName, urlName]: string[] = ['node:fs', 'node:url'];
const fs = (await import(fsName!)) as unknown as {
  readdirSync(path: string): string[];
  readFileSync(path: string, enc: string): string;
};
const url = (await import(urlName!)) as unknown as { fileURLToPath(href: string): string };
const here = url
  .fileURLToPath((import.meta as unknown as { url: string }).url)
  .replace(/\\/g, '/')
  .replace(/\/[^/]*$/, '');
const repoRoot = `${here}/../../../..`;
const env = (globalThis as unknown as { process?: { env: Record<string, string | undefined> } })
  .process?.env;
const out = (globalThis as unknown as { console: { log(s: string): void } }).console;
const filesIn = (dir: string, ext: string): string[] =>
  fs
    .readdirSync(`${repoRoot}/${dir}`)
    .filter((n) => n.endsWith(ext))
    .sort();
const sum = (items: readonly LineBreakArtifacts[]): LineBreakArtifacts =>
  items.reduce(addArtifacts, NO_ARTIFACTS);
const fmt = (a: LineBreakArtifacts): string =>
  `hyphen=${a.hyphenArtifacts} midWord=${a.midWordBreaks} midSentence=${a.midSentenceBreaks}`;
/** What the model reads: the extraction prompt's notes block for each dev note. */
function promptCounts(): Map<string, LineBreakArtifacts> {
  const counts = new Map<string, LineBreakArtifacts>();
  for (const name of filesIn('eval/dev/notes', '.txt')) {
    const text = fs.readFileSync(`${repoRoot}/eval/dev/notes/${name}`, 'utf8');
    const doc = prepareDocument(text);
    const prompt = buildConceptExtractionUserMessage(doc);
    // Count the notes text inside the prompt, not the prompt's own "[chunk id]" lines.
    const texts = [...doc.quotableChunksByOrdinal.values()]
      .map((c) => c.text)
      .filter((t) => prompt.includes(t));
    counts.set(name, sum(texts.map(countLineBreakArtifacts)));
  }
  return counts;
}
/** Questions, answers, aliases, options and quotes in the dev gold labels. */
function labelCounts(): LineBreakArtifacts {
  const strings = filesIn('eval/dev/questions', '.json').flatMap((name) =>
    collectStrings(JSON.parse(fs.readFileSync(`${repoRoot}/eval/dev/questions/${name}`, 'utf8'))),
  );
  return sum(strings.map(countLineBreakArtifacts));
}
/** Every string the model returned in the recorded cassette. */
function cassetteCounts(): LineBreakArtifacts {
  const raw = fs.readFileSync(
    `${repoRoot}/packages/core/src/test-support/cassettes/human-heart-e2e.json`,
    'utf8',
  );
  return sum(collectStrings(JSON.parse(raw)).map(countLineBreakArtifacts));
}
describe('line-break artifacts in dev-set material (no live calls)', () => {
  const prompts = promptCounts();
  const labels = labelCounts();
  const cassette = cassetteCounts();
  it('reports counts when EVAL_REPORT is set', () => {
    if (env?.EVAL_REPORT === undefined) return;
    for (const [name, c] of prompts) out.log(`prompt  ${name}: ${fmt(c)}`);
    out.log(`prompt  TOTAL: ${fmt(sum([...prompts.values()]))}`);
    out.log(`dev gold labels (questions, answers, quotes): ${fmt(labels)}`);
    out.log(`human-heart cassette (model responses): ${fmt(cassette)}`);
  });
  it('has no line-break artifacts in any extraction prompt', () => {
    for (const [name, c] of prompts) expect({ name, ...c }).toEqual({ name, ...NO_ARTIFACTS });
  });
  it('has no line-break artifacts in the gold labels or the cassette', () => {
    expect(labels).toEqual(NO_ARTIFACTS);
    expect(cassette).toEqual(NO_ARTIFACTS);
  });
});
