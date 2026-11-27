---
name: grounded-quiz
description: Write a quiz from the learner's own notes in which every question cites an exact quote that is checked against the notes. Use when the user asks for a quiz, flashcards, fill-in-the-blank or multiple-choice questions, or revision questions from notes they provide.
---

# Grounded quiz from your notes

Write questions that the notes themselves answer, and let code check the evidence. The model drafts. The tools decide whether a quote is really in the notes, whether an answer leaks, and whether a choice question is backed by evidence. A question that fails a check is fixed or set aside, never waved through.

## Before you start

- You need the notes as text, 6,000 words or fewer. If the user has more, ask for one section at a time. Never invent notes or fill gaps from general knowledge.
- The tools run in a local server that keeps the notes in memory only. The notes still go to whichever model runs this chat, as in any Kiro conversation. Say so if the user asks.

## Step 1: Prepare the notes

Call `prepare_notes` with the full text. It returns a `notesId` and the notes split into numbered paragraphs with their exact text. Cite these paragraph numbers. Do not invent chunk IDs or character offsets: code finds the position of every quote itself. Lines listed under `headings` are context only and cannot be quoted.

## Step 2: Choose what to ask about

Pick facts a paragraph states plainly. Skip anything the notes state vaguely, or two paragraphs state differently: leave that concept out and tell the user why.

## Step 3: Draft the questions

Use the formats in `references/question-formats.md`. Six lock types are supported:

- **rune-cipher**: fill in one blank. The answer must appear in the quote.
- **seance-board**: choose from 3 or 4 options. The prompt starts "According to your notes". Exactly one option is `supported` by a quote and each other option is `contradicted` by a quote. An option the notes merely do not mention cannot be used.
- **bone-ordering**: put 3 to 5 steps in order. Use it only when a quote states the order outright ("first", "then", "next", numbering).
- **bound-threads**: match 3 or 4 pairs strictly one to one. Each pair has its own quote that states that pairing.
- **cursed-object**: four items, three that share a category and one that does not. `answer` is the odd item's exact text, `categoryRule` states the category in a sentence, and the evidence has a quote that sets the category and a different quote that places the odd item outside it. Use it only when the notes say so outright.

Rules for every question:

- Every question cites at least one `paragraph` and an exact `quote` of 4 to 25 words, copied from that paragraph's text. Do not paraphrase a quote.
- Ask what the notes say, in positive form. No "which is not", "except", "false" or "incorrect". The one exception is the odd-one-out prompt of a cursed-object question.
- The answer must not appear in the prompt, and no question may give away another question's answer.
- Each answer is asked once. Numbers come from the notes word for word: a number the notes only imply, or one you worked out yourself outside a template, is set aside.
- Write "your notes", not a generic word such as "the document".

## Step 4: Check, then repair or set aside

1. Call `check_question` for each draft, or `resolve_quote` first if a quote is the doubt. Each failure comes with a Check_ID, a plain statement of the problem and a fix.
2. Fix what the advice says. After two repairs of the same question, set it aside. Never change a quote to match what you wish the notes said, and never drop a check. When unsure, set the question aside.
3. Call `check_quiz` on the whole set before you present it. It also catches an answer leaked into another question, and two questions with the same answer.
4. If a quote fails for a reason you cannot see (curly quotes, a hyphen at a line break), call `normalise_text` to see what the resolver compares. `list_checks` lists every check and its advice.

## Step 5: Present the quiz

- Show each question that passes, with its source: "Paragraph N of your notes" and the quote.
- You may say "Source excerpt matched" for a quote that resolved. Say "passes these checks" for a question that passed `check_question` and `check_quiz`.
- List the questions you set aside, each with its Check_ID and one line on why.
- Say what the tools did not check: whether a question is a good one, and the blind review (a second reader answering without the key) that the Escape the Crypt app runs. Offer to do a blind pass: answer each question from the notes alone, without the key, and compare.
- Do not promise results. Do not call the quiz accurate or certified, and do not claim it improves learning.
