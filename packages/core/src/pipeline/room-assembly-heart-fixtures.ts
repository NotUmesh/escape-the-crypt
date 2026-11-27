import { parseAuthoringQuestion } from '../authoring/parse';
import type { AuthoringQuestion } from '../authoring/schema';
import { heart } from './generation-fixtures';
import type { PreparedDocument } from './prepare-input';
import type { AssemblyConcept } from './room-assembly';

const [fsName, urlName]: string[] = ['node:fs', 'node:url'];
const fs = (await import(fsName!)) as unknown as { readFileSync(p: string, enc: string): string };
const url = (await import(urlName!)) as unknown as { fileURLToPath(href: string): string };
const here = url
  .fileURLToPath((import.meta as unknown as { url: string }).url)
  .replace(/\\/g, '/')
  .replace(/\/[^/]*$/, '');

export { heart };

interface Ev {
  readonly paragraph: number;
  readonly quote: string;
}
interface RawQuestion {
  readonly id: string;
  readonly evidence?: readonly Ev[];
  readonly options?: readonly { evidence: Ev }[];
  readonly [key: string]: unknown;
}

const raw = (
  JSON.parse(fs.readFileSync(`${here}/../../../../samples/questions/human-heart.json`, 'utf8')) as {
    questions: RawQuestion[];
  }
).questions;

/** Paragraph number (heading is paragraph 1) -> pipeline ordinal, as in blind-review-fixtures. */
function paragraphToOrdinal(doc: PreparedDocument): Map<number, number> {
  const out = new Map<number, number>();
  for (const chunk of doc.chunks.values()) {
    if (chunk.location.sourceType !== 'paste') continue;
    const ordinal = doc.ordinalByChunkId.get(chunk.id);
    if (ordinal !== undefined && !out.has(chunk.location.paragraphNumber)) {
      out.set(chunk.location.paragraphNumber, ordinal);
    }
  }
  return out;
}

const ordinals = paragraphToOrdinal(heart);

function remap<T extends { paragraph: number }>(e: T): T {
  const to = ordinals.get(e.paragraph);
  if (to === undefined) throw new Error(`paragraph ${e.paragraph} has no chunk`);
  return { ...e, paragraph: to };
}

/** A sample question (e.g. `hh-q01`) re-keyed to pipeline ordinals, with optional field overrides. */
export function hh(id: string, over: Record<string, unknown> = {}): AuthoringQuestion {
  const base = raw.find((q) => q.id === id);
  if (base === undefined) throw new Error(`no sample question ${id}`);
  const q = JSON.parse(JSON.stringify(base)) as Record<string, unknown>;
  if (base.evidence) q.evidence = base.evidence.map(remap);
  if (base.options) q.options = base.options.map((o) => ({ ...o, evidence: remap(o.evidence) }));
  const parsed = parseAuthoringQuestion({ ...q, ...over });
  if (!parsed.ok) throw new Error(`fixture ${id} invalid at ${parsed.error.path}`);
  return parsed.value;
}

export function concept(
  conceptId: string,
  primary: AuthoringQuestion | null,
  alternate: AuthoringQuestion | null = null,
): AssemblyConcept {
  return { conceptId, label: `Label ${conceptId}`, primary, alternate };
}

/** Concept hh-c01: rune primary (answer "atrioventricular"), séance alternate. */
export const conceptC01 = (): AssemblyConcept => concept('hh-c01', hh('hh-q01'), hh('hh-q02'));
/** Concept hh-c02: séance primary, rune alternate (answer "left ventricle"). */
export const conceptC02 = (): AssemblyConcept => concept('hh-c02', hh('hh-q03'), hh('hh-q04'));
