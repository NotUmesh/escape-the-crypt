# Front of house: design brief

Status: **design only, for review.** No code has been written. Machine: the second computer.
Scope: presentation of the pre-crypt screens (desk hub, bring your notes, the dig, the descent).
Out of scope and not touched: `apps/web/src/state/**`, `packages/core/src/pipeline/**`, `apps/worker/**`, and the logic of ingest, generation and persistence.

## 1. What I found in the code (facts the design rests on)

| Area | Today |
| --- | --- |
| `app.tsx` | Route `/` is a title and one link. Route `/ingest` renders `IngestScreen`: `IngestFlow` then `CryptFlow` as siblings. Notes text reaches `CryptFlow` through `onConfirmed`. |
| `CryptFlow` | Owns the room binding **and** `useGeneration`. Its start phase renders `StartView` (Enter the crypt, Generate, sample offer, `ResumeEntry`). A `ready` generation calls `startRun` at once in an effect. |
| Announcers | `IngestFlow` renders its own `LiveAnnouncer` (`role=status`). `CryptFlow` renders `LiveRegion` only when no job runs. `ExportControl` has its own `aria-live`. `ResumeEntryView` has a `role="status"` line. The generate e2e asserts exactly one `[aria-live]` during generation. |
| Generation state | `idle / starting / polling / ready / failed / cancelled`. It **drops** the worker's `queued` vs `running`. It has no start time. The worker status body carries **no progress counts** (`job-response-schema.ts`). |
| Saved crypts | `findResumable` returns **one** run (latest active). There is no list-all query. `deleteCrypt(manifestId)` exists. |
| Samples | Three note files and three question files exist (`human-heart`, `https`, `printing-press`). `buildHumanHeartSampleCrypt` hard-codes `manifestId: 'human-heart-sample'`, and `restoreRun` rebuilds samples through `buildSampleCrypt` (human heart only). All three question files say `status: draft…`, so none may carry "Human-reviewed". |
| Art | Desk: desktop (1920×1080, `@2x`) and mobile (1080×1920) background, foreground, candle; `books/book-1..4.webp` (868×146 blank spines). Motion: `descent-desk` and `descent`, each webm + mp4 + 1920×1080 poster. **No `-mobile` clips exist.** No cavern art exists. |
| Style guard | Under `features/ingest/`: no `url()`, no `background:`, no `background-image`, no `vw/vh`, no `position: fixed`. App-wide: colour literals only in `tokens.css`, no cross-origin URLs. |
| CSP | `default-src 'self'` covers `<video>`; no change needed to `_headers`. |
| Lantern | `LanternProvider` lives inside `CryptFlow`. It defaults on under `prefers-reduced-motion`. |

What I saw in the art (viewed, not assumed): the desktop desk background is a stone study with a bookshelf, a desk with an open book at centre, an inkwell with a quill, an arched teal doorway behind the desk, and a large dark floor. `candle.webp` holds one small candle body at about (0.686, 0.54) of the frame (on the dark disc of the desk). `foreground.webp` is two bed-post silhouettes and a rail at the bottom. The mobile background is a portrait crop with the desk at about 54–65% of the height and a dark floor below. The `descent-poster` is the first crypt room.

## 2. Decisions I need from you (before any code)

1. **Book stack needs a list query.** Only one run can be found today. I propose the hub reads a `ShelfEntry[]` through one seam (`use-shelf.ts`). I write the interim adapter over `findResumable`, so the hub shows at most one saved book until the other machine adds `listShelf` in `state/storage`. Shape I need is in section 9.
2. **Real counts.** The worker sends no counts, and generation state hides queued vs running. The dig can honestly show: real elapsed time (client clock), pieces and words of the notes sent, and an optional list of worker counts that shows only when present. I will **not** draw a percentage bar or fake room counts. If you want "rooms ready 2 of 5", the worker machine must add a `progress` field and `generationReducer` must keep it (generation logic).
3. **Three samples.** Playable only after `manifestId` is per sample and `restoreRun` can rebuild each one. Until then the registry marks two as `ready: false` and the hub lists only the human heart. Labels say "Sample crypt", never "Human-reviewed", because all three files are `draft`.
4. **Cavern.** No cavern art exists. Recommended: draw it in code (SVG silhouettes, token gradient, slow mist), which also gives a plain lit look in lantern mode. Alternative: reuse `descent-poster.webp` darkened behind a scrim. I recommend code.
5. **Phone descent.** No mobile clips. Recommended: phones play the desktop clips with `object-fit: cover`, centred (the centre crop keeps the arch and the first room's door). If you dislike the crop, fall back to a poster crossfade on phones. I cannot check clip composition frame by frame, only the posters.
6. **Descent on Continue.** Recommended: the descent plays when a crypt starts fresh (generated, sample, start again) and not when "Continue your crypt" restores a run.
7. **Existing e2e.** 19 e2e files drive `/ingest → paste → Confirm notes → Enter the crypt`. I keep that path and its labels. The descent adds a Skip click to the shared helper `enterCrypt`. Three resume specs move to start at `/` because the resume entry moves to the hub (section 8).

## 3. Rules this design follows

- Readability over atmosphere: every block of text sits on a **solid** panel (`--stone-800` with `--bone-50`/`--stone-300`, or `--parchment-100` with `--ink-900`). Art and scrims never carry text. Scrims are `--stone-950` at partial opacity and sit behind panels only.
- No colour literals outside `tokens.css`. Art is `<img>`, never CSS `url()`. Atmosphere layers use `pointer-events: none`.
- Contrast: 4.5:1 body, 3:1 large. `--ember-600` is not used for text on `--stone-800`. Gold (`--candle-400`) only marks a lit or success state.
- Keyboard: every action reachable; focus ring from `--focus-ring` (`--focus-ring-on-light` on parchment). Touch targets at least 44×44.
- One announcer per screen. Motion has a reduced-motion and a Skip path. Nothing blocks input for more than 1 s.
- Copy follows `tone.md`. No accuracy, mastery or learning-gain claims (see `evidence-and-honesty.md`).

## 4. Screen map

```
/  (route home)                  /ingest (route ingest)
 DESK HUB  --link-->  BRING YOUR NOTES  --Generate-->  THE DIG  --ready-->  DESCENT --> CRYPT
   |  \--Sample / Continue / Start again ------------------------------------^  (descent plays)
   |                                  ^--cancel / failed (notes kept)--|
```

The screen is **derived**, not a new machine:
`screenFor({ route, notesConfirmed, generationStatus, phase, descending })` is a pure function in `features/desk/screen-flow.ts`.
Only `descending` is new view state, held in `CryptFlow`.

## 5. Architecture (smallest change to the existing flow)

`CryptFlow` keeps the binding and `useGeneration`. It gets **three additive seams**, all optional so existing tests keep passing:

1. `renderStart?: (ctx: StartContext) => ReactNode`. Default renders `StartView` as today. `ctx` carries what `StartView` already gets: `generation` state, `generate()`, `cancel()`, `playSample()`, `enter()`, `resume` node, `canGenerate`, plus `play(crypt: BuiltCrypt | null)` (the existing `onStartAgainSaved` logic exposed, so a chosen sample or a start-again can start fresh).
2. `descending` view state plus `<DescentGate>`: set when a crypt starts fresh, cleared on end or skip. The run starts at once (no delay to saving). While the gate is up the room view is `inert` and `aria-hidden`.
3. `onAnnounce` already exists; the descent posts "Descending into the crypt." through the crypt's own `LiveRegion` (the single announcer once a run is on screen).

`app.tsx` renders the same `CryptFlow` for **both** routes (the hub needs the binding for Continue and samples, and `LanternProvider`). The route only chooses which pre-crypt screen `renderStart` returns.

`IngestFlow` stays mounted across bring ↔ dig (cancel returns to the same notes: "Stopped. Your notes are still here."). It unmounts during a run. Consequence: coming back from a run lands on the hub, not on a blank paste box. I need your confirmation of that path (section 10, Q3).

Single announcer, concretely:
- `ShellAnnouncer` (one `role=status aria-live=polite aria-atomic` region) is mounted with the pre-crypt screens. It replaces the `IngestFlow` announcer, which gets an `onAnnouncement` prop and then renders none of its own.
- `ExportControl` and `ResumeEntryView` get a prop that turns their live roles off and sends the text to the announcer instead. The visible text stays.
- Once a run is on screen, the shell announcer is unmounted and the crypt `LiveRegion` is the only one (as today).

## 6. Screens

### 6.1 Desk hub (`/`)

Art, back to front: `background` (`@2x` srcset on desktop) → `candle` + code flame (`Flame kind="ambient"`, a ~1px/2s flicker, off in lantern/reduced motion) → `foreground` → atmosphere (vignette only; none in lantern). The candle is decorative and `aria-hidden`; blowing it out is the first beat of the `descent-desk` clip, not a hotspot. Nothing needs the art to be operable.

Desktop (≥ phone aspect), content in normal flow over the art, not pinned to art coordinates:

```
+--------------------------------------------------------------+
| [Lantern mode toggle]                                        |
|  +-------------------+                +--------------------+ |
|  | ESCAPE THE CRYPT  |  (art: desk,   | YOUR CRYPTS        | |
|  | one-line lede     |   open book,   |  [spine] Crypt …   | |
|  | [Bring your notes]|   teal arch)   |  [spine] Crypt …   | |
|  | SAMPLE CRYPTS     |                |  selected card:    | |
|  |  [Human heart]    |                |  Continue | Start  | |
|  |  Sample crypt     |                |  again | Export    | |
|  +-------------------+                +--------------------+ |
+--------------------------------------------------------------+
```

Components:
- `DeskHub`: `<main>` with `<h1>` (Cinzel). Left panel: lede, **Bring your notes** (an `<a href="/ingest">` styled as the primary button, so the existing link test holds), sample list.
- `BookStack`: `<ul>` of `BookSpine` buttons, newest on top, spine art cycles `book-1..4`. Label (title, date, state) is HTML text on the spine's plate area over a solid strip, never baked in art. Up to 6 shown; the rest sit in a "More crypts (n)" disclosure `<details>`.
- Selected book card: state chip with icon and text ("In progress", "Escaped", "Review due: n" only when the data exists), and `ResumeEntry` buttons (Continue your crypt / Start again) plus `BookExport` ("Export a copy (this file contains your notes)").
- `SampleShelf`: one button per ready sample, named "Enter the crypt: <title>", with the "Sample crypt" label.
- Empty shelf: "No crypts on this device yet. Bring your notes to start one."
- The spine art is about 5.9:1 wide. Each spine button is at least 44px high at every width; the `<img>` sits inside the button, so the button is the hit target.

Phone: mobile art as a backdrop anchored to the top (`object-fit: cover; object-position: top`). One column: title panel first, then the book stack, then samples. The stack scrolls with the page. No fixed positioning.

Lantern: no vignette or flicker; the same solid panels. Reduced motion: no flicker, no parallax.

### 6.2 Bring your notes (`/ingest`)

The desk, pushed in on the open book. Push-in is a 600 ms CSS scale from the book's point on mount (instant under reduced motion or lantern).

Desktop is a two-page open book (parchment panel, `--ink-900` text):

```
+--------------------------------------------------------------+
| Back to the desk                                             |
| Before you bring your notes (privacy notice, full width)     |
| +------------------------------+---------------------------+ |
| | LEFT PAGE                    | RIGHT PAGE                | |
| |  Paste your notes (textarea) |  Pages we read (list)     | |
| |  word count                  |  Preview editor           | |
| |  PDF picker + page checks    |  [Confirm notes]          | |
| +------------------------------+---------------------------+ |
| After confirm:  Your notes are ready · N pieces              |
|   [ SETTINGS SLOT: length and difficulty ]                   |
|   [Generate from my notes]  [Enter the crypt] sample line    |
+--------------------------------------------------------------+
```

How it is built without touching ingest logic:
- The existing `IngestFlow` renders unchanged inside `.book-pages`. `open-book.css` (new, outside `features/ingest/`, so the ingest style guard does not apply) re-lays its existing classes in a grid: privacy `.ingest-privacy` spans both columns on row 1; `.ingest-paste` and `.ingest-pdf` fill the left page; the page list and `.ingest-preview` fill the right page.
- Focus order equals visual order: paste, PDF controls, then page list and preview. The privacy notice has no controls, so reading it first in the DOM does not break that.
- The existing parchment and `ingest-on-light` ring rules stay. Class names `.ingest-root`, `.ingest-paste textarea`, "Confirm notes" and the others are unchanged, so the layout, storage and network e2e specs keep their selectors.
- Phone: one page, in DOM order. The two-column grid applies only from a container width of 56rem (container query on `.book-pages`).

Settings slot:
- `features/desk/settings-slot.tsx` exports `SettingsSlot(): ReactNode` and currently returns `null`. It renders inside `<div class="book-settings-slot" data-testid="settings-slot">` between the confirmed summary and the Generate button.
- The other machine replaces the body of that one file. The slot owns its own fieldset and legend. I add no placeholder controls, so nothing misleading ships.

Start actions (`StartActions`): the content of today's `StartView` moved into the book's last page, same labels (`ENTER_CRYPT_LABEL`, `GENERATION_COPY.generateButton`, `SAMPLE_CRYPT_LINE`, sample offer after a failure). `GenerationNotice` is reused as is for the stopped and failed messages, so focus handling and test ids (`generation-cancelled`, `generation-failed`) stay.

### 6.3 The dig (generation running)

Shown while generation status is `starting` or `polling`. `IngestFlow` stays mounted but `hidden`.

```
+--------------------------------------------------------------+
|  (code-drawn cavern: stalactite silhouettes, mist, dark)     |
|           +----------------------------------------+         |
|           | DIGGING YOUR CRYPT                     |         |
|           | Building your crypt from your notes.   |         |
|           | This can take a minute or two.         |         |
|           | Time so far   0:42                     |         |
|           | Your notes    6 pieces · 412 words     |         |
|           | [worker counts, only when sent]        |         |
|           | [ Cancel ]                             |         |
|           +----------------------------------------+         |
+--------------------------------------------------------------+
```

- `DigScreen`: `<main>` with `<h1>` "Digging your crypt". Reuses `GenerationNotice` for the progress sentence and Cancel (same text, same `data-testid="generation-progress"`, same focus-on-appear).
- `ElapsedTimer` + `useElapsed(clock)`: starts when status first becomes `starting`, counts whole seconds with an injected clock, stops on any other status. Rendered as `<time>` text inside `role="timer"` (no live announcements per second).
- Announcements go through `ShellAnnouncer`: the existing progress sentence once, then "Still working. 1 minute so far." each full minute. Cancel and failure messages are the existing copy.
- `DigCounts`: pieces and words come from the confirmed notes already in memory (`INGEST_UI_COPY.chunkCount` exists). Worker counts render as a `<dl>` only if the optional `progress` prop has entries.
- Motion: mist drifts slowly (same technique as `atmosphere-layer.css`), a few dust specks fall. No flashing and no progress bar. Reduced motion or lantern: static, flat `--stone-800` surface, no mist.
- Failed or cancelled: the screen returns to Bring your notes with the existing message and the same buttons (sample offer, Generate again). Notes are never lost.

### 6.4 Descent

`DescentGate` covers the room view with `descent-desk` then `descent`, both `muted playsInline`, no audio.

- Sources: `<source>` webm first, then mp4 (Chromium builds without H.264 still work). `poster` is the matching poster. `object-fit: cover`.
- A **Skip** button is the first focus target, visible at once, 44px minimum. Escape also skips. A click, Enter or Space on Skip ends it.
- Sequence in `useDescentSequence`: clip 1 `ended` → clip 2 `ended` → done. Any `error`, or no `canplay` within 1.5 s, ends the sequence early (the crypt is already running behind it).
- **Reduced motion:** no `<video>` is mounted. The gate finishes immediately, announces "Descending into the crypt.", and focus goes to the room.
- Lantern mode alone does not remove the clip (it is not a motion setting); the Skip button covers that.
- On finish: remove `inert`, move focus to the room's heading or container, post the announcement. Focus never lands on a removed node.
- Media is served from `/art/motion/…` (same origin, CSP unchanged).

## 7. Files

### Create (all files ≤ ~300 lines, kebab-case)

`apps/web/src/features/desk/`
- `screen-flow.ts` (+ `.test.ts`): pure `screenFor`.
- `shell-announcer.tsx` (+ test).
- `desk-art.tsx`, `desk-scene.tsx`, `desk-scene.css`, `desk-scene-layout.ts`: layered art, desktop vs phone set, candle point, push-in origin. A desk-specific image component (the crypt's `ArtImage` is room-path specific).
- `desk-hub.tsx`, `desk-hub.css`.
- `book-stack.tsx`, `book-spine.tsx`, `book-stack.css`.
- `book-export.tsx`: restores a run with `restoreRun`, then calls `prepareExport` and `downloadJson`. Composition of existing functions; no new storage code.
- `shelf-entry.ts`, `use-shelf.ts`: the `ShelfEntry` type and the interim adapter.
- `sample-crypts.ts`, `sample-shelf.tsx`: registry (`id`, `title`, notes and questions file, `ready`), built with core's `buildHumanHeartSampleCrypt`, passed to `ctx.play`. Titles taken from the first line of each notes file: "The human heart", "How HTTPS keeps a connection private", "The printing press".
- `bring-notes-screen.tsx`, `open-book.css`, `start-actions.tsx`, `settings-slot.tsx`.
- `front-of-house-copy` additions in core (see below).

`apps/web/src/features/dig/`: `dig-screen.tsx`, `dig.css`, `cavern.tsx` (SVG), `elapsed-timer.tsx`, `use-elapsed.ts`, `format-elapsed.ts`, `dig-counts.tsx`.

`apps/web/src/features/descent/`: `descent-gate.tsx`, `descent.css`, `use-descent-sequence.ts`, `clip-sources.ts`.

`packages/core/src/copy-front-of-house.ts`, exported from `index.ts` (every visible string lives in core copy, as for ingest). Draft strings:
- Hub: "Escape the Crypt"; "Bring your notes to the desk. Every lock is a question from them."; "Your crypts"; "No crypts on this device yet. Bring your notes to start one."; "Sample crypts"; "Back to the desk".
- Dig: "Digging your crypt"; "Time so far"; "Your notes"; "Still working. {n} so far."
- Descent: "Descending into the crypt."; "Skip".

E2E: `e2e/desk-hub.e2e.ts`, `e2e/desk-axe.e2e.ts`, `e2e/desk-keyboard.e2e.ts`, `e2e/front-of-house-flow.e2e.ts`, `e2e/panel-opacity.e2e.ts`.

### Modify (presentation or wiring only)

| File | Change |
| --- | --- |
| `src/app.tsx` | Both routes render `CryptFlow` with `renderStart`. `IngestScreen` keeps its name and props (`app.test.tsx` imports it). |
| `src/routes.ts` | No change unless I add the dig/descent names (not needed; screens are derived). |
| `src/features/crypt/crypt-flow.tsx` | Add `renderStart`, `descending` + `DescentGate`, expose `play`. Default path unchanged. It is 288 lines now, so I move the start-context assembly into `crypt-flow-start.tsx` to stay under 300. |
| `src/features/ingest/ingest-flow.tsx` | Add optional `onAnnouncement`; when set, do not render the inline `LiveAnnouncer`. No logic change. |
| `src/features/start/export-control.tsx`, `resume-entry.tsx` | Optional prop to drop `aria-live` / `role=status` and report text upward. Defaults unchanged. |
| `src/styles/app.css` | `.screen` is capped at 48rem; the desk screens need full width. Scope the cap to the non-desk screens. |
| `e2e/crypt-helpers.ts` | `enterCrypt` clicks Skip when the descent is up. |
| `e2e/resume-entry.e2e.ts`, `resume-entry-axe.e2e.ts`, `reload-resume.e2e.ts` | Start at `/` (resume entry now lives on the hub). |

### Not touched
`src/state/**`, `packages/core/src/pipeline/**`, `apps/worker/**`, `generation-flow.ts`, `use-generation.ts`, `worker-client.ts`, `ingest-machine.ts`, anything in `locks/` or `runtime/`.

## 8. Accessibility and lantern notes

- Landmarks: one `<main>` per screen; `<h1>` per screen; panels are `<section aria-labelledby>`.
- Art is `alt=""`; nothing needed to act lives only in art. Spine buttons carry their text label.
- Lantern mode: no atmosphere (vignette, mist, grain), no flame flicker, no push-in animation. Layout and contrast are unchanged. The toggle (`LanternToggle`) appears on the hub and on Bring your notes; the same setting applies in the crypt.
- 200% zoom: single-column below the container breakpoint; the two-page book never forces horizontal scroll.
- Pointer: the stack and samples work by tap; nothing needs hover.

## 9. What I need from the other machine

1. `listShelf(factory): Promise<StorageResult<readonly ShelfEntry[]>>` in `state/storage`, with at least `{ manifestId, runId | null, status: 'active'|'escaped'|'left', createdAt, source: 'sample'|'generated', roomCount, dueConceptCount? }`. A review-due count needs a core selector; I found `selectSpiritCandles` only, so the due chip stays hidden until one exists.
2. Per-sample `manifestId` and a `restoreRun` that rebuilds any sample (for the other two samples).
3. The length/difficulty component that fills `settings-slot.tsx`.
4. Optional: a `progress` object in the job status and the reducer, if you want real worker counts.

## 10. Test plan

**Component tests (Vitest + Testing Library; no real provider; fake timers and fake media elements)**
- `screen-flow`: example table plus a fast-check property: `crypt` is unreachable without `phase==='running'`; `dig` only while `starting|polling`; `descent` only when `descending`.
- `ShellAnnouncer`: one region, message updates, no duplicate on re-render.
- `DeskHub`: empty shelf copy; stack order and the 6-book cap with "More crypts"; a book button exposes its text label; Bring your notes is a link to `/ingest`; samples with `ready: false` are absent; no "Human-reviewed" text anywhere on the hub.
- `BookExport`: label text unchanged, status text goes to the announcer, no `aria-live` of its own.
- `BringNotesScreen`: renders `IngestFlow` unchanged; settings slot sits between the summary and Generate in DOM order; slot absent content renders nothing; `StartActions` keeps every label from `StartView`.
- `DigScreen`: progress sentence and Cancel present; elapsed formats (`0:09`, `1:05`, `61:00`); the timer stops on `ready`/`failed`/`cancelled`; counts match the notes; worker counts appear only when passed; no progressbar role.
- `useDescentSequence`: clip 1 → clip 2 → done; error and 1.5 s no-`canplay` both finish once; Skip and Escape finish once; reduced motion mounts no `<video>` and finishes at once; done never fires twice.
- Existing suites that must stay green unchanged: `ingest-*`, `generation-*`, `use-generation*`, `crypt-flow*`, `resume-entry`, `app.test`.
- Style guard: `style-guard.test.ts` over the new CSS (no colour literals, no cross-origin URLs); a test that every new image is an `<img>`; `scene-files-exist`-style test that every art path used by the desk, books and clips exists.
- Contrast unit test from `tokens.css` for each panel pairing used (bone/stone-800, stone-300/stone-800, ink-900/parchment-100, spectre-300/stone-800).

**axe per screen (Playwright, `@axe-core/playwright`, tags wcag2a/aa, 21aa, 22aa)**
Screens: hub empty; hub with a saved book; bring (empty); bring (preview open); bring (confirmed, with a stub in the settings slot); dig; descent (clip up); failure (each of the existing failure kinds). Each runs in lantern on and off, on desktop and the Pixel 7 project. axe cannot judge text over images, so `panel-opacity.e2e.ts` walks every visible text node and asserts its nearest opaque ancestor is a solid panel (alpha 1). The existing Firefox quirk (axe plus `toBeVisible()` polling) is respected by using `waitFor()` before the scan, as the resume spec does.

**Keyboard and touch**
- Keyboard-only run: hub → Bring your notes → paste → Confirm → Generate → Cancel → Generate → Skip → first lock. Assert focus order equals visual order on the two-page book, and focus after Skip lands in the room.
- Every control at least 44×44 and uncovered, reusing the `checkControls` approach from `ingest-layout.e2e.ts`, on hub, bring, dig and descent.
- Manual before milestone: one screen reader pass (hub, bring, dig, descent), 200% zoom, a mid-range Android phone.

**Mocked paste → generate → descent → crypt e2e (`front-of-house-flow.e2e.ts`, uses `installFakeWorker`)**
1. Motion allowed: paste sample notes, Confirm, Generate. Assert the dig screen, the exact progress sentence, one live region, a ticking elapsed value. Let the fake complete. Assert the descent gate, two `<video>` sources served from the app origin, Skip focused. Dispatch `ended` on both clips, assert the room opens and focus moves into it.
2. Same, but click Skip during clip 1.
3. Clip request aborted (`page.route`): the sequence ends by itself within about 2 s.
4. `emulateMedia({ reducedMotion: 'reduce' })`: no `<video>` exists, the room opens, the announcement is read, lantern defaults on.
5. Cancel during the dig: one DELETE, notes still in the textarea state, both buttons return.
6. No request leaves the app origin except the worker origin (existing `foreignRequests` helper).

## 11. Build order (when you approve)

1. Copy and tokens-free styles; `screen-flow`, `use-elapsed`, `use-descent-sequence` with tests (pure first).
2. `ShellAnnouncer` and the three small prop additions (ingest, export, resume), with the single-announcer test.
3. `renderStart` and `DescentGate` seams in `CryptFlow`; default path proven by the existing suites.
4. Hub, then Bring your notes, then the dig, then the descent.
5. e2e and axe; migrate the helper and the three resume specs.

## 12. Open questions

1. Is the descent allowed to skip on Continue (my default), or should it play every time a run opens?
2. Phone clips: centre crop of the desktop clips, or poster crossfade? (Decision 5.)
3. After a run ends, should "back to the desk" be the hub page (my assumption, since `IngestFlow` unmounts during a run)?
4. Should the hub offer deleting a saved crypt? `deleteCrypt` exists, but you did not list it, so I left it out.
5. Are the sample titles above right? I took them from the first line of each notes file.
