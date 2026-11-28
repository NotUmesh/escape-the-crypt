import type { Disagreement, TypeStats } from './ratings-section';

export type Verdict = 'correct' | 'wrong' | 'unsure';
export const VERDICTS: readonly Verdict[] = ['correct', 'wrong', 'unsure'];

/** One rated question. `accepted` comes from the result file, never from the CSV. */
export interface RatedItem {
  readonly key: string;
  readonly note: string;
  readonly conceptIndex: number;
  readonly role: 'primary' | 'alternate';
  readonly lockType: string;
  readonly result: string;
  readonly accepted: boolean;
  readonly verdict: Verdict;
}

function ratio(n: number, d: number): number | null {
  return d === 0 ? null : Math.round((n / d) * 10_000) / 10_000;
}

/** Counts and rates per lock type. Pure. */
export function statsByType(items: readonly RatedItem[]): Record<string, TypeStats> {
  const tally = new Map<string, Record<Exclude<keyof TypeStats, `${string}Rate${string}`>, number>>();
  for (const item of items) {
    const t =
      tally.get(item.lockType) ??
      { accepted: 0, rejected: 0, acceptedCorrect: 0, acceptedWrong: 0, acceptedUnsure: 0, rejectedCorrect: 0, rejectedWrong: 0, rejectedUnsure: 0 };
    const side = item.accepted ? 'accepted' : 'rejected';
    t[side] += 1;
    const field = `${side}${item.verdict[0]?.toUpperCase()}${item.verdict.slice(1)}` as keyof typeof t;
    t[field] += 1;
    tally.set(item.lockType, t);
  }
  const out: Record<string, TypeStats> = {};
  for (const [lockType, t] of [...tally].sort(([a], [b]) => a.localeCompare(b))) {
    out[lockType] = {
      ...t,
      wrongAcceptedRate: ratio(t.acceptedWrong, t.accepted),
      wrongAcceptedRateMax: ratio(t.acceptedWrong + t.acceptedUnsure, t.accepted),
      correctRejectedRate: ratio(t.rejectedCorrect, t.rejected),
      correctRejectedRateMax: ratio(t.rejectedCorrect + t.rejectedUnsure, t.rejected),
    };
  }
  return out;
}

/** Cohen's kappa over three verdicts. Null when there is no overlap or chance agreement is already 1. */
export function cohenKappa(pairs: readonly (readonly [Verdict, Verdict])[]): number | null {
  const n = pairs.length;
  if (n === 0) return null;
  const agreed = pairs.filter(([a, b]) => a === b).length / n;
  const chance = VERDICTS.reduce((sum, v) => sum + (pairs.filter(([a]) => a === v).length / n) * (pairs.filter(([, b]) => b === v).length / n), 0);
  if (chance === 1) return null;
  return Math.round(((agreed - chance) / (1 - chance)) * 10_000) / 10_000;
}

export interface Comparison {
  readonly overlap: number;
  readonly agreed: number;
  readonly agreementRate: number | null;
  readonly kappa: number | null;
  readonly disagreements: readonly Disagreement[];
  /** Items both raters rated alike, rated once. */
  readonly consensus: readonly RatedItem[];
}

/** Two raters over the same questions. Disagreements are listed one by one, with both verdicts. */
export function compareRaters(a: { readonly name: string; readonly items: readonly RatedItem[] }, b: typeof a): Comparison {
  const byKey = new Map(b.items.map((i) => [i.key, i] as const));
  const pairs: (readonly [Verdict, Verdict])[] = [];
  const disagreements: Disagreement[] = [];
  const consensus: RatedItem[] = [];
  for (const left of a.items) {
    const right = byKey.get(left.key);
    if (right === undefined) continue;
    pairs.push([left.verdict, right.verdict]);
    if (left.verdict === right.verdict) consensus.push(left);
    else {
      disagreements.push({
        note: left.note,
        conceptIndex: left.conceptIndex,
        role: left.role,
        lockType: left.lockType,
        result: left.result,
        verdicts: { [a.name]: left.verdict, [b.name]: right.verdict },
      });
    }
  }
  return {
    overlap: pairs.length,
    agreed: consensus.length,
    agreementRate: ratio(consensus.length, pairs.length),
    kappa: cohenKappa(pairs),
    disagreements,
    consensus,
  };
}
