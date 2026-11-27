# Escape the Crypt

Escape the Crypt turns your own notes (pasted text or a text PDF) into a short, candle-lit escape room where every lock is a question from them. Each question shows the passage it came from and can be challenged without penalty.

Built for Kiroween 2026 (Costume Contest) with Kiro. Every spooky element carries a study meaning: a correct answer lights a candle, a missed concept returns as a ghost, and the Autopsy at the end counts what happened.

## Try it

- **Live app:** https://escape-the-crypt.pages.dev
- **Demo video:** TODO (capture): add the link when the video is uploaded.

## Try it in 60 seconds

<!-- TODO (verify after the front-of-house integration lands): these steps describe the desk hub. Re-walk them on the live URL before submitting. -->

1. Open the live app. You are at the desk.
2. Choose **Enter the crypt: The human heart**. It is a bundled sample crypt and says "Sample crypt" on screen. No notes, no upload, and nothing is sent to a server.
3. Pick a lock object in the room and answer its question. Every answer shows the source passage it came from.
4. A correct answer lights a candle. A wrong answer raises a ghost for that concept, and the concept comes back later as a different question. You can use a hint, skip, or **challenge** a question; a challenged question is excluded from your score.
5. Open the final door. Escape is always possible. The Autopsy then shows five counts: first-try correct, assisted, retried, challenged, review due.

To try your own notes, choose **Bring your notes** on the desk, paste text (or choose a text PDF), check the preview, confirm, then **Generate from my notes**. This needs the generation worker (see "Limits" for what is sent).

## How it works

```
your notes → concepts → questions checked against your notes → rooms
```

1. **Notes.** Your text stays in your browser. PDF text is read on your device by pdf.js in a web worker. The text is split into chunks of up to 1,200 characters, and **code** assigns each chunk an ID.
2. **Concepts.** A model finds the concepts and cites chunk IDs and exact quotes. Code keeps only quotes that resolve to exactly one cited chunk. The model never supplies character offsets.
3. **Questions.** A model writes questions for each concept, each with chunk IDs and an exact quote. Generated crypts use two lock types today: rune cipher (fill in the blank) and séance board (choose the option your notes support). Choice questions are framed "According to your notes…" and every option must be supported or contradicted by the quote.
4. **Checks.** Code rejects a question when, for example, the quote cannot be found or is too short or too long, the answer is not in the quote, the answer is leaked in the prompt, the question is negative, or the options are not exactly one supported answer. A second model call then answers the question from the notes without being told the intended answer (the blind review). If it disagrees, the question is set aside. When unsure, the pipeline sets a question aside; it never lowers a check to get more questions.
5. **Rooms.** Accepted questions are placed into a room, at most one lock per lock type. The published room manifest is immutable. The game itself is a pure reducer over an event log, so a reload replays to the same state.

On screen you will see these labels, and only when they are true: "Source excerpt matched", "Blind model review passed", "Challenged: excluded from score", "Review due". "Human-reviewed" is reserved for sample questions a person has reviewed, and none of the samples carry it yet.

## Run it locally

You need Node 22 (the repo requires `>=22 <23`) and pnpm 12.23.0 (pinned in `package.json`).

```sh
corepack enable
git clone https://github.com/NotUmesh/escape-the-crypt.git
cd escape-the-crypt
pnpm install --frozen-lockfile
pnpm dev                    # the web app, with the bundled sample crypt
```

The sample crypt needs nothing else. To generate crypts from notes, run the worker and point the web app at it.

```sh
pnpm --filter @escape-the-crypt/worker build
# set the worker variables below in the worker's environment, then:
pnpm --filter @escape-the-crypt/worker start
# in another terminal:
VITE_WORKER_URL=http://localhost:8787 pnpm dev
```

**Worker environment variables** (names only; the worker reads `process.env` and loads no `.env` file):

| Name | Required | Meaning |
| --- | --- | --- |
| `OPENAI_API_KEY` | yes | Key for the model provider. Never commit it. |
| `OPENAI_MODEL` | yes | Model ID to use. |
| `WEB_ORIGIN` | yes | The origin the web app is served from (for CORS). |
| `DAILY_BUDGET_USD` | to accept jobs | Daily spending cap. Without it the worker refuses jobs. |
| `PRICE_INPUT_USD_PER_MTOK` | to accept jobs | Input price per million tokens, for the budget. |
| `PRICE_OUTPUT_USD_PER_MTOK` | to accept jobs | Output price per million tokens, for the budget. |
| `PORT` | no | Defaults to 8787. |
| `JOB_TTL_MINUTES` | no | How long a finished job is kept. Defaults to 30. |

`.env.example` lists the same names. **Web build variable:** `VITE_WORKER_URL` is the worker's `https://` origin (plain `http://` only for `localhost` or `127.0.0.1`). Without it the "Generate from my notes" button is hidden.


## Tests

```sh
pnpm test         # unit, property-based and recorded-cassette tests: core, web, worker, scripts
pnpm lint         # eslint and the structure checks (scripts/check-structure.ts)
pnpm typecheck
pnpm --filter @escape-the-crypt/web exec playwright install --with-deps chromium firefox   # once
pnpm e2e          # Playwright: Chromium, Firefox and Pixel 7 emulation, including axe scans
```

- Tests never call a real AI provider. They replay recorded cassettes, and the end-to-end tests answer the worker origin with a fake.
- Counts from a run on 2026-11-27 (HEAD `6be0ebc` plus uncommitted edits): core 143 files, 1,145 tests; worker 19 files, 228 tests; web 136 files, 1,126 tests; scripts 1 file, 24 tests; all passed. The last full end-to-end run in `docs/build-log.md` (Checkpoint 30) was 172 passed, 0 failed, 1 skipped.
- TODO: re-run `pnpm test` and `pnpm e2e` on the final commit and update these numbers.
- Paid evaluation runs go only through the evaluation skill (`.kiro/skills/evaluation/SKILL.md`). Replaying recorded cassettes is free:
  `pnpm --filter @escape-the-crypt/worker eval replay --model <model-id> --policy both`

## Repo layout

```
apps/web/        React + Vite game: desk, notes, dig, descent, rooms, locks, Autopsy
apps/worker/     Node service: generation jobs, interim budget ledger, job API, evaluation CLI
packages/core/   engine, no React or database: chunking, quote resolver, contracts,
                 lock-type judges and checks, generation pipeline, room runtime reducer
samples/         original sample notes and their question files
eval/dev/        practice notes and labels (tuning happens here only)
eval/adversarial/ questions that must be rejected
eval/results/    run files written by the evaluation skill
eval/holdout/    final test set: not in the repository until the final run
docs/            build log, briefs, art contract and prompt logs
.kiro/           specs, steering, hooks, skills
scripts/         structure checks (file size, naming, imports, build contents)
```

## Measured quality

Not measured yet. These cells are filled only from runs on the held-out set, after the configuration is frozen, and each links to its `eval/results/` file. Numbers from the dev set are tuning aids and are not reported as quality. The two recorded dev runs in `eval/results/` predate the current checks (Check_Version `2026-11-27.1`; the code is now `2026-11-27.2`) and need re-recording; one paid re-record is planned after phase 5.

| Measure | Set | Configuration (model, Check_Version, prompt versions) | Result | Source file |
| --- | --- | --- | --- | --- |
| Questions accepted per lock type | holdout | TODO | TODO | TODO |
| Rejected by code check (per Check_ID) | holdout | TODO | TODO | TODO |
| Rejected by blind review | holdout | TODO | TODO | TODO |
| Adversarial questions wrongly accepted | adversarial | TODO | TODO | TODO |
| Wrong-accepted questions found by a human reader | holdout | TODO | TODO | TODO |
| Cost per generated crypt (USD) | holdout | TODO | TODO | TODO |
| Time per generated crypt | holdout | TODO | TODO | TODO |

## Limits

- **Text-based PDFs only.** No OCR. A page with no readable text is flagged so you can remove it or paste the text instead. Limits: 5 MiB per file, 10 pages chosen, 6,000 words of notes, 20 seconds of reading.
- **English prose notes.** Not built for maths-heavy, diagram-heavy or scanned material, and no non-English generation.
- **Generated crypts are small today.** A generated crypt is one room with up to two lock types (rune cipher and séance board). The other four lock types (bone ordering, bound threads, cursed object, combination dial) are in the engine and being added to generation; the sample crypts show what the full set looks like. TODO: update this line when multi-room and the other lock types reach generation.
- **Questions can be wrong.** Code checks and the blind review reduce errors; they do not remove them. That is why every question shows its source and can be challenged.
- **No claims about learning.** The app does not claim to improve results, mastery or exam performance.
- **AI provider and what is sent.** Generation uses OpenAI through the worker, with the model named by `OPENAI_MODEL`. Only the text of the notes you confirm is sent (up to 6,000 words), plus the worker's own prompts. Your PDF file and its name never leave your device. The worker keeps job text and results only while the job runs and for 30 minutes after it ends by default, then keeps a content-free record for 24 hours. Its logs hold counts, timings and error types, never notes or model output. Under OpenAI's default API terms, data sent to the API is not used to train OpenAI's models, and OpenAI may keep it for up to 30 days for abuse monitoring. See [OpenAI's API data controls page](https://developers.openai.com/api/docs/guides/your-data) for the details, which can change.
- **The worker's budget cap is in memory.** It resets if the worker restarts. The backstop is a monthly limit on the provider project. A database-backed ledger is planned.
- **Samples are drafts.** The sample question files are marked draft until the author has read every question, so none shows the "Human-reviewed" label yet. TODO: update after review.
- **Not in this version:** accounts, leaderboards, teacher mode, multiplayer, OCR, diagram labelling, server-side storage of private uploads.
- **Art is AI-generated and disclosed** in `ASSETS.md`, with prompt logs in `docs/art/`. Interface elements are drawn in code.

## Licence

MIT, copyright 2026 NotUmesh. Sample notes are original. Third-party and generated assets are listed in `ASSETS.md`; fonts are under the SIL Open Font License 1.1.
