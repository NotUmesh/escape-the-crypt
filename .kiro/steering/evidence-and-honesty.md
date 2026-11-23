---
inclusion: always
---

# Evidence and honesty

This product lives or dies on trust. Follow these rules in every piece of code, copy and prompt.

## Question generation
- Every question must cite one or more **code-assigned chunk IDs** plus a short **exact quote**. Code resolves the quote; the model never supplies character offsets.
- A lock type may be generated only when its "generated only when" condition is met (see `packages/core/src/locks/`). Never force a type to fill a quota.
- Choice questions are framed "According to your notes…". Each option must be **supported** or **contradicted** by quoted evidence. Options that are only "not mentioned" are rejected. No negative questions.
- Numbers come from the source verbatim or from an allowlisted formula template computed by code. Never execute model-written code or expressions.
- When unsure, **set the question aside**. Never lower a check to get more questions.
- If two passages conflict on a concept, exclude that concept before publishing and tell the learner why.
- Published room manifests are immutable.

## Language we never use
Do not write "verified", "guaranteed", "100% accurate", "hallucination-free", "mastered", "exam-ready", or claims of learning gains, in code, UI copy, docs or the README.

## Labels we do use
"Source excerpt matched" · "Blind model review passed" · "Human-reviewed" (samples only) · "Challenged: excluded from score" · "Review due".

If the learner edited extracted PDF text, citations say: "Your edited notes, originally extracted from PDF page X."

## Evaluation
- Prompt tuning, model choice and verifier experiments happen only on `eval/dev/`.
- Never read, tune against or summarise `eval/holdout/` until the configuration is frozen.
- Report real numbers, including wrong-accepted questions and failures.
