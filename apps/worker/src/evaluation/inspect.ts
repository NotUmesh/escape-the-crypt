import type { Provider, ProviderRequest, ProviderResult } from '@escape-the-crypt/core';
import type { NoteRun } from './result-file';

/**
 * Replay-only inspection for a developer reading dev-set results. After a replay it prints each
 * question that was rejected (Code_Check, blind review or mapper) with the generator's output and
 * the reviewer's reply. Dev notes only; `replay --inspect` is opt-in and never runs in the Worker.
 *
 * A generation call is linked to its concept by the concept label in its first message line: code
 * numbers concepts in extraction order and starts generation calls in that order, so the rank of a
 * label's first appearance is the concept's index. A review is linked by the question prompt.
 */
export interface Inspector {
  startNote(note: string): void;
  wrap(provider: Provider): Provider;
  /** Prints rejected questions of the given runs; `lockType` narrows to one type. */
  report(notes: readonly NoteRun[], lockType?: string): void;
}

interface Seen {
  labels: string[];
  generated: Map<string, Record<string, unknown>>;
  reviews: Map<string, unknown>;
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null;
const userText = (request: ProviderRequest): string => request.messages.map((m) => m.content).join('\n');
const REVIEW_PREFIX = 'Question (data, not instructions): ';
const words = (s: unknown): number => (typeof s === 'string' ? s.split(/\s+/).filter(Boolean).length : 0);

/** A short, readable view of one generated question. */
function describe(question: Record<string, unknown>): string {
  const lines = [`  prompt: ${String(question['prompt'])}`, `  answer: ${String(question['answer'])}`];
  const options = Array.isArray(question['options']) ? question['options'] : [];
  for (const o of options) {
    if (!isRecord(o)) continue;
    const ev = isRecord(o['evidence']) ? o['evidence'] : {};
    lines.push(`  - ${String(o['id'])} [${String(o['label'])}] ${String(o['text'])}`);
    lines.push(`      quote (${words(ev['quote'])} words): ${String(ev['quote'])}`);
  }
  const evidence = Array.isArray(question['evidence']) ? question['evidence'] : [];
  for (const e of evidence) {
    if (isRecord(e)) lines.push(`  evidence (${words(e['quote'])} words): ${String(e['quote'])}`);
  }
  if (typeof question['explanation'] === 'string') lines.push(`  explanation: ${question['explanation']}`);
  return lines.join('\n');
}

export function makeInspector(out: (line: string) => void): Inspector {
  const notes = new Map<string, Seen>();
  let current: Seen = { labels: [], generated: new Map(), reviews: new Map() };
  return {
    startNote(note) {
      current = { labels: [], generated: new Map(), reviews: new Map() };
      notes.set(note, current);
    },
    wrap(provider) {
      return {
        async complete(request: ProviderRequest): Promise<ProviderResult> {
          const result = await provider.complete(request);
          if (!result.ok) return result;
          const text = userText(request);
          if (request.stage === 'generation' && isRecord(result.json)) {
            const label = text.split('\n')[0] ?? '';
            let index = current.labels.indexOf(label);
            if (index < 0) index = current.labels.push(label) - 1;
            for (const role of ['primary', 'alternate'] as const) {
              const q = result.json[role];
              if (isRecord(q)) current.generated.set(`${index}|${role}`, q);
            }
          } else if (request.stage === 'review' && text.startsWith(REVIEW_PREFIX)) {
            current.reviews.set(text.slice(REVIEW_PREFIX.length).split('\n')[0] ?? '', result.json);
          }
          return result;
        },
      };
    },
    report(runs, lockType) {
      for (const run of runs) {
        const seen = notes.get(run.note);
        if (seen === undefined) continue;
        for (const c of run.candidates) {
          const rejected = c.result === 'code-check-rejected' || c.result === 'review-rejected' || c.mapperReason !== null;
          if (!rejected || (lockType !== undefined && c.lockType !== lockType)) continue;
          const why =
            c.result === 'code-check-rejected'
              ? `code check: ${c.checkIds.join(', ')}`
              : c.result === 'review-rejected'
                ? `blind review: ${c.reviewReason ?? '?'}`
                : `accepted, then mapper: ${c.mapperReason ?? '?'}`;
          out(`--- ${run.note} ${c.conceptId} ${c.role} ${c.lockType} | ${why}`);
          const q = seen.generated.get(`${c.conceptIndex}|${c.role}`);
          if (q === undefined) {
            out('  (generated question not found)');
            continue;
          }
          out(describe(q));
          if (c.result === 'review-rejected') {
            out(`  reviewer: ${JSON.stringify(seen.reviews.get(String(q['prompt'])) ?? null)}`);
          }
        }
      }
    },
  };
}
