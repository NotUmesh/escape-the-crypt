---
inclusion: always
---

# Product: Escape the Crypt

## What it is
A study app that turns a learner's own notes (pasted text or a text PDF) into a short, candle-lit escape room. Every lock is a question generated from their material. Correct answers light candles and bring light back into the crypt. Missed concepts return later as ghosts. Every question shows its source passage and can be challenged without penalty.

Built for Kiroween 2026, Costume Contest category: every spooky element must carry learning meaning, never pure decoration.

## Who it's for
College students and adult learners (18+) revising from short English prose notes and explanatory texts. Not marketed to children. Not for math-heavy, diagram-heavy or scanned material in this version.

## Core loop
1. Paste notes or upload a text PDF → editable extraction preview
2. A background job generates and checks questions; rooms open one at a time as they finish
3. Play: pick a lock, answer, see the source evidence
4. Correct → a candle lights (the lock is **solved**)
5. Wrong → a ghost for that concept appears; it returns later as a different question (two attempts, then **review due**)
6. Challenge or Skip → the lock is **settled** (excluded from score), replaced by the alternate if one is unused
7. Final door mixes concepts from all rooms → escape (always possible)
8. Autopsy report: first-try correct, assisted, retried, challenged, review due
9. Next visit on this device: review of concepts still due

## Six lock types (supported, never a quota)
Rune cipher (cloze) · Séance board (source-bound choice) · Bone ordering (explicit sequences only) · Bound threads (strict one-to-one matching) · Cursed object (odd one out from an explicit category) · Combination dial (stated numbers or allowlisted formula templates). A document only gets the types its evidence supports.

## Non-goals (this version)
Accounts, leaderboards, teacher mode, multiplayer, OCR, diagram labelling, non-English generation, server-side storage of private uploads, any claim of learning gains, mastery or exam readiness.

## Success looks like
A learner finishes a short run unassisted, trusts the questions because they can see the evidence, and chooses to play again.
