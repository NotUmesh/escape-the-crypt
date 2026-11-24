---
inclusion: always
---

# Structure

```
.kiro/               specs, steering, hooks, agents, skills (always committed)
apps/web/            React game: upload, preview, rooms, locks, report
  src/features/      one folder per feature (ingest, crypt, locks, report, review)
  src/components/    shared UI components
  src/state/         React binding for the runtime + persistence (no game rules)
apps/worker/         generation jobs, budget ledger, judge access API
packages/core/       engine: chunking, quotes, contracts, lock rules, checks
  src/locks/         one file per lock type: generation rules + checks + answer judge
  src/runtime/       room-runtime: pure reducer over the event log (no timers, randomness or I/O)
samples/             original notes for human-reviewed sample crypts
eval/dev/            practice notes + labels (tuning happens here only)
eval/adversarial/    questions that must be rejected
eval/holdout/        final test set (git-ignored until the final run)
docs/build-log.md    daily build log
```

## Rules
- Lock-type logic lives only in `packages/core/src/locks/<type>.ts`, with a matching `<type>.test.ts`.
- The room-runtime reducer in `packages/core/src/runtime/` is the single source of truth for game state; UI components never change state directly. Answer judges live in `packages/core/src/locks/<type>.ts`. Only the React binding and persistence live in `apps/web/src/state/`.
- Test fixtures shared across specs live in `packages/core/src/test-support/` next to `arbitraries.ts` (for example the manifest fixture builder).
- Shared types for questions, manifests and events live in `packages/core/src/types.ts`.
- Names: files in kebab-case, React components in PascalCase, types in PascalCase, functions in camelCase.
- No file over ~300 lines; split by responsibility.
- Never put runtime logs, user content or secrets anywhere under `.kiro/`.
