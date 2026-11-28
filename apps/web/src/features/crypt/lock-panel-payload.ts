import { createContext, useContext, useEffect, useRef } from 'react';
import type {
  BoneOrderingQuestion,
  BoundThreadsQuestion,
  CombinationDialQuestion,
  CursedObjectQuestion,
  HintEffectSpec,
} from '@escape-the-crypt/core';
import { useLockPanelContext } from './lock-panel-context';
import type { LockPanelContextValue } from './lock-panel-context';

/** The payload shape each of the four panels reads. */
export interface LockPayloadByType {
  readonly 'bone-ordering': BoneOrderingQuestion;
  readonly 'bound-threads': BoundThreadsQuestion;
  readonly 'combination-dial': CombinationDialQuestion;
  readonly 'cursed-object': CursedObjectQuestion;
}
export type PayloadLockType = keyof LockPayloadByType;

/** The one announcer the panels speak through. The default says nothing. */
export const LockAnnounceContext = createContext<(message: string) => void>(() => undefined);
export function useLockAnnounce(): (message: string) => void {
  return useContext(LockAnnounceContext);
}

const isStrings = (v: unknown): v is readonly string[] => Array.isArray(v) && v.every((x) => typeof x === 'string');
const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null;
const isPair = (v: unknown): boolean => isStrings(v) && v.length === 2;
const finite = (v: unknown): boolean => v === undefined || (typeof v === 'number' && Number.isFinite(v));

const GUARDS: { readonly [K in PayloadLockType]: (v: unknown) => v is LockPayloadByType[K] } = {
  'bone-ordering': (v): v is BoneOrderingQuestion => isObject(v) && isStrings(v['itemIds']) && isStrings(v['keyOrder']),
  'bound-threads': (v): v is BoundThreadsQuestion =>
    isObject(v) &&
    isStrings(v['leftIds']) &&
    isStrings(v['rightIds']) &&
    Array.isArray(v['keyPairs']) &&
    v['keyPairs'].every(isPair),
  'cursed-object': (v): v is CursedObjectQuestion =>
    isObject(v) && isStrings(v['optionIds']) && typeof v['oddOneOutId'] === 'string',
  'combination-dial': (v): v is CombinationDialQuestion =>
    isObject(v) &&
    (v['kind'] === 'exact' || v['kind'] === 'range' || v['kind'] === 'tolerance') &&
    typeof v['unit'] === 'string' &&
    finite(v['exactValue']) &&
    finite(v['min']) &&
    finite(v['max']) &&
    finite(v['value']) &&
    finite(v['tolerance']),
};

/** The slot's payload, or null when it is missing or has another lock type's shape. */
export function useLockPayload<T extends PayloadLockType>(
  slotId: string,
  questionId: string,
  type: T,
): LockPayloadByType[T] | null {
  const env = useLockPanelContext();
  if (env === null || env.payloadFor === undefined) return null;
  const value = env.payloadFor(slotId, questionId);
  return GUARDS[type](value) ? value : null;
}

/** The slot's applied hint effect, when the hint is for this question. */
export function hintEffectFor(env: LockPanelContextValue, slotId: string, questionId: string): HintEffectSpec | null {
  const hint = env.appliedHintFor(slotId);
  return hint !== null && hint.questionId === questionId ? (hint.effect ?? null) : null;
}

/**
 * Announces a hint that arrives while the panel is open (the learner pressed Hint). A hint already
 * applied when the panel mounts, as after a restore, is not announced again.
 */
export function useHintAnnouncement(hint: HintEffectSpec | null, message: (hint: HintEffectSpec) => string): void {
  const announce = useLockAnnounce();
  const key = hint === null ? null : JSON.stringify(hint);
  const seen = useRef<string | null>(key);
  const latest = useRef(message);
  latest.current = message;
  useEffect(() => {
    if (key === seen.current) return;
    seen.current = key;
    const text = hint === null ? '' : latest.current(hint);
    if (text !== '') announce(text);
  }, [key, hint, announce]);
}

/** The text of one option, or a plain fallback when the content lacks it. */
export function itemText(env: LockPanelContextValue, questionId: string, itemId: string, fallback: string): string {
  return env.content.questions[questionId]?.options?.[itemId] ?? fallback;
}

/** True when the last rejection is an invalid submission for this slot. */
export function rejectedInvalid(env: LockPanelContextValue, slotId: string): boolean {
  return env.rejection?.kind === 'invalid-submission' && env.rejection['slotId'] === slotId;
}

export { useLockPanelContext };
