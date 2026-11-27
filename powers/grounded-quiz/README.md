# Grounded Quiz: a Kiro Power

Make a quiz from your own notes in your own Kiro, where every question cites an exact quote and code checks the quote against your notes. It packages the quote resolver, the text normaliser and the evidence code checks from [Escape the Crypt](https://github.com/NotUmesh/escape-the-crypt), the study game that turns notes into an escape room.

Kiro's model drafts the questions. The Power's tools decide whether each quote really appears once in the paragraph it cites, whether the answer leaks, whether the question is negative, and whether every choice option is backed by evidence. A question that fails is fixed or set aside.

## What it is not

- It does not generate questions by itself. Kiro's model writes them, using the skill's rules.
- A question that passes these checks is not thereby a good one. The tools do not judge whether a question is worth asking, or whether the answer is the only reasonable one.
- It does not run the blind model review that the Escape the Crypt app runs (a second reader answering without the key).
- It supports all six question types: rune cipher (fill in one blank), séance board (choose one of 3 or 4 options), bone ordering (put 3 to 5 steps in order), bound threads (match 3 or 4 pairs one to one) cursed object (find the odd one out of four) and combination dial (a number the notes state, a stated range, or one of two formulas that code computes: a difference or a percent change). Prose notes in English, up to 6,000 words.

## Install

You need Node 20 or newer on your PATH. The server is one bundled file and installs nothing else.

**From GitHub, in the Kiro IDE.** Powers panel, **Add Custom Power**, **Import power from GitHub**, then paste the folder URL:

```
https://github.com/NotUmesh/escape-the-crypt/tree/main/powers/grounded-quiz
```

**From a local copy.** Clone the repository, then Powers panel, **Add Custom Power**, **Import power from a folder**, and choose `powers/grounded-quiz`. In the CLI: `kiro-cli powers install <path>`.

## Use it

Say something that matches the Power's keywords, for example:

> Make a quiz from these notes, with fill-in-the-blank and multiple-choice questions. [paste your notes]

Kiro loads the `grounded-quiz` skill and the Power's tools, prepares the notes, drafts questions, checks them, and shows you the ones that pass with their source paragraph and quote. It also lists the questions it set aside and why, and says what the tools did not check. [`skills/grounded-quiz/references/worked-example.md`](skills/grounded-quiz/references/worked-example.md) walks through a real run on `samples/human-heart.txt`.

## Tools

| Tool | What it does |
| --- | --- |
| `prepare_notes` | Splits your notes into numbered paragraphs, returns their text and a `notesId`. Questions cite those paragraph numbers |
| `resolve_quote` | Checks that an exact quote appears once in one paragraph, after normalising whitespace, curly quotes, ligatures and line-break hyphens. Returns the matched text, or why it failed |
| `check_question` | Runs the evidence code checks on one question |
| `check_quiz` | Runs every check on a set of up to 40 questions, including leaks and repeated answers across questions |
| `normalise_text` | Shows the exact string the resolver compares |
| `list_checks` | Lists every check, its severity and its advice |

## What the checks cover

Quotes: the quote is in the cited paragraph exactly once, is 4 to 25 words and at least 20 characters, and the paragraph exists. Cloze: one blank, the answer is in a quote, the answer is not in the prompt or in another question. Choice: the prompt starts "According to your notes", there are 3 or 4 options, none repeated, each backed by a resolving quote, exactly one `supported` and the rest `contradicted`, and the key is the supported one. Ordering: 3 to 5 distinct steps and a quote that states the order. Matching: 3 or 4 pairs, one to one, each with a resolving quote. Odd one out: exactly 4 items, the answer is one of them, a category rule, and separate quotes that set the category and place the odd item outside it. Every question: no negative wording, no banned wording, and no two questions with the same answer. The version of the checks is reported with every result (`checkVersion`).

## Privacy

The server holds your notes in memory only, for the sessions it is running, up to 8 sets at a time, and forgets them when it stops. It reads no files and opens no network connections: the bundle imports only Node's `readline`, and a test asserts it. Kiro's own model still sees your notes, as in any conversation.

## How it is built

The server (`src/`) is a small MCP server that imports the quote resolver, normaliser, document preparation and check code from `packages/core` **without changing it**. `node powers/grounded-quiz/scripts/build.mjs` bundles it with everything it imports into `server/index.mjs`, which is committed so the Power works as installed. Core's public index does not export the check functions, so the Power imports core's source files directly through one file, `src/core-imports.ts`.

Tests run with the rest of the repository (`pnpm test`; the files are in `test/`). They run each tool on `samples/human-heart.txt`, drive the bundled server over stdio, check the manifest files against the Agent Plugins format Kiro documents, and check that the worked example and the question formats in the documentation run as written. One test fails if core's `CHECK_VERSION` changes and the bundle has not been rebuilt.

## Licence

MIT, as the rest of Escape the Crypt. See `LICENSE`.
