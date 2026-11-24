import { judgeRegistry } from '../locks/judge-registry';
import type {
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
} from '../locks/judge-registry';
import type { HintEffectSpec, JudgeResult, LockType } from '../types';

/**
 * Run the judge for one lock type. The judges are total; the try/catch is a last guard so
 * a malformed payload or submission becomes `invalid` instead of an exception.
 */
export function runJudge(
  lockType: LockType,
  payload: unknown,
  submission: unknown,
  hint: HintEffectSpec | null,
): JudgeResult {
  try {
    switch (lockType) {
      case 'rune-cipher':
        return judgeRegistry[lockType](
          payload as RuneCipherQuestion,
          submission as RuneCipherSubmission,
          hint,
        );
      case 'seance-board':
        return judgeRegistry[lockType](
          payload as SeanceBoardQuestion,
          submission as SeanceBoardSubmission,
          hint,
        );
      case 'bone-ordering':
        return judgeRegistry[lockType](
          payload as BoneOrderingQuestion,
          submission as BoneOrderingSubmission,
          hint,
        );
      case 'bound-threads':
        return judgeRegistry[lockType](
          payload as BoundThreadsQuestion,
          submission as BoundThreadsSubmission,
          hint,
        );
      case 'cursed-object':
        return judgeRegistry[lockType](
          payload as CursedObjectQuestion,
          submission as CursedObjectSubmission,
          hint,
        );
      case 'combination-dial':
        return judgeRegistry[lockType](
          payload as CombinationDialQuestion,
          submission as CombinationDialSubmission,
          hint,
        );
    }
  } catch {
    return 'invalid';
  }
}
