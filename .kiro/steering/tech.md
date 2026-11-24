---
inclusion: always
---

# Tech

## Stack
- **Language:** TypeScript everywhere (strict mode). Node 22.
- **Front end:** React + Vite (`apps/web`). Plain CSS + SVG for visuals. No 3D libraries.
- **Worker:** Node service (`apps/worker`) that runs generation jobs. Always-on host, so no serverless timeouts.
- **Shared engine:** `packages/core` holds chunking, quote resolution, question contracts, lock-type rules and checks. It must not depend on React, the database or any AI SDK directly (pass providers in), so it can be packaged as a Kiro Power.
- **Database:** Postgres for jobs, the budget ledger and judge access. No user content outside job records.
- **Browser storage:** IndexedDB for manifests, event log, review state.
- **PDF:** pinned pdf.js running in a web worker.
- **Validation:** Zod for every schema crossing a boundary (model output, API requests, stored records).
  - Note: parseNotesRecord is hand-checked and tested; migrate to Zod in spec 3.
- **Package manager:** pnpm workspaces.

## Testing
- Vitest for unit tests; fast-check for property-based and model-based tests; Playwright for end-to-end; axe for automated accessibility checks.
- GitHub Actions CI runs lint, type-check and all deterministic tests. CI is the release gate; hooks are only fast feedback.
- Tests never call a real AI provider. Use recorded fixtures. Paid evaluation runs only through the evaluation skill.

## Conventions
- Prefer small pure functions in `packages/core`; side effects at the edges.
- Every model call goes through one provider interface with timeout, token limit and retry limit parameters.
- No `any`. No `eval`, `new Function` or dynamic code execution, ever.
- Errors are typed results, not thrown strings, in `packages/core`.

## Commands
- `pnpm install` · `pnpm dev` · `pnpm test` · `pnpm lint` · `pnpm typecheck` · `pnpm e2e`
(Keep this list accurate as scripts are added.)
