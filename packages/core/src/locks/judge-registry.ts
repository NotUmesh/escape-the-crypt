import type { HintEffectSpec, JudgeResult, LockType } from '../types';
import { judge as judgeBoneOrdering } from './bone-ordering';
import type { BoneOrderingQuestion, BoneOrderingSubmission } from './bone-ordering';
import { judge as judgeBoundThreads } from './bound-threads';
import type { BoundThreadsQuestion, BoundThreadsSubmission } from './bound-threads';
import { judge as judgeCombinationDial } from './combination-dial';
import type { CombinationDialQuestion, CombinationDialSubmission } from './combination-dial';
import { judge as judgeCursedObject } from './cursed-object';
import type { CursedObjectQuestion, CursedObjectSubmission } from './cursed-object';
import { judge as judgeRuneCipher } from './rune-cipher';
import type { RuneCipherQuestion, RuneCipherSubmission } from './rune-cipher';
import { judge as judgeSeanceBoard } from './seance-board';
import type { SeanceBoardQuestion, SeanceBoardSubmission } from './seance-board';

export type {
  BoneOrderingQuestion,
  BoneOrderingSubmission,
  BoundThreadsQuestion,
  BoundThreadsSubmission,
  CombinationDialQuestion,
  CombinationDialSubmission,
  CursedObjectQuestion,
  CursedObjectSubmission,
  RuneCipherQuestion,
  RuneCipherSubmission,
  SeanceBoardQuestion,
  SeanceBoardSubmission,
};

/** A pure, total judge. Questions, submissions and hints are plain JSON data. */
export interface Judge<Q, S> {
  (question: Q, submission: S, appliedHint: HintEffectSpec | null): JudgeResult;
}

/** One judge per lock type, keyed by the LockType ID. */
export type JudgeRegistry = {
  readonly 'rune-cipher': Judge<RuneCipherQuestion, RuneCipherSubmission>;
  readonly 'seance-board': Judge<SeanceBoardQuestion, SeanceBoardSubmission>;
  readonly 'bone-ordering': Judge<BoneOrderingQuestion, BoneOrderingSubmission>;
  readonly 'bound-threads': Judge<BoundThreadsQuestion, BoundThreadsSubmission>;
  readonly 'cursed-object': Judge<CursedObjectQuestion, CursedObjectSubmission>;
  readonly 'combination-dial': Judge<CombinationDialQuestion, CombinationDialSubmission>;
};

export const judgeRegistry: JudgeRegistry & Record<LockType, unknown> = {
  'rune-cipher': judgeRuneCipher,
  'seance-board': judgeSeanceBoard,
  'bone-ordering': judgeBoneOrdering,
  'bound-threads': judgeBoundThreads,
  'cursed-object': judgeCursedObject,
  'combination-dial': judgeCombinationDial,
};
