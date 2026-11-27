# Worked example

A real run on `samples/human-heart.txt` (9 paragraphs, 325 words). The tool results are what the server returns, shortened where marked. `powers/grounded-quiz/test/docs.test.ts` runs every question below through the tools and asserts the results shown, so this page cannot drift from the code.

## 1. Prepare the notes

The agent calls `prepare_notes` with the text of the notes. The result begins:

```json
{
  "notesId": "notes_62a99254e222",
  "wordCount": 325,
  "paragraphCount": 9,
  "headings": [],
  "paragraphs": [
    { "paragraph": 1, "text": "The human heart" },
    "… (paragraphs 2 to 5) …",
    {
      "paragraph": 6,
      "text": "Valves keep blood flowing in one direction. The valves between the atria and ventricles are called the atrioventricular valves, or AV valves: the tricuspid valve on the right and the mitral valve on the left. The pulmonary valve and the aortic valve sit where blood leaves the ventricles."
    },
    "… (paragraphs 7 to 9) …"
  ],
  "quoteRules": { "minWords": 4, "minChars": 20, "maxWords": 25 }
}
```

Each paragraph also carries its `chunkId` and word count (left out here). The agent now drafts questions that cite paragraph numbers.

## 2. First draft: a quote that is not in the notes

The agent writes a cloze question about the valves and quotes paragraph 6, but gets one word wrong.

<!-- example:draft-1 -->
```json
{
  "id": "v1",
  "conceptId": "valves",
  "role": "primary",
  "lockType": "rune-cipher",
  "caseSensitive": false,
  "prompt": "According to your notes, the valves between the atria and ventricles are called the ______ valves.",
  "answer": "atrioventricular",
  "aliases": [
    "AV"
  ],
  "evidence": [
    {
      "paragraph": 6,
      "quote": "The valves between the atria and ventricles are called the mitral valves"
    }
  ],
  "explanation": "Your notes call them the atrioventricular (AV) valves."
}
```

`check_question` result (shortened):

```json
{ "passes": false, "blocking": [ { "checkId": "quote-not-found", "fix": "Copy the quote exactly from the paragraph text returned by prepare_notes, or cite the paragraph it really sits in." } ] }
```

The notes say "atrioventricular valves", not "mitral valves". Code found no match, so the question cannot stand on that quote. The agent copies the sentence from paragraph 6 instead.

## 3. Second draft: the prompt gives the answer away

The quote is now right, but the new prompt contains the answer.

<!-- example:draft-2 -->
```json
{
  "id": "v1",
  "conceptId": "valves",
  "role": "primary",
  "lockType": "rune-cipher",
  "caseSensitive": false,
  "prompt": "According to your notes, the atrioventricular valves lie between the atria and ventricles. What are the ______ valves also called?",
  "answer": "atrioventricular",
  "aliases": [
    "AV"
  ],
  "evidence": [
    {
      "paragraph": 6,
      "quote": "The valves between the atria and ventricles are called the atrioventricular valves"
    }
  ],
  "explanation": "Your notes call them the atrioventricular (AV) valves."
}
```

```json
{ "passes": false, "blocking": [ { "checkId": "answer-leak-in-prompt", "fix": "Rephrase the prompt so it does not contain the answer." } ] }
```

## 4. Third draft: it passes

<!-- example:draft-3 -->
```json
{
  "id": "v1",
  "conceptId": "valves",
  "role": "primary",
  "lockType": "rune-cipher",
  "caseSensitive": false,
  "prompt": "According to your notes, the valves between the atria and ventricles are called the ______ valves.",
  "answer": "atrioventricular",
  "aliases": [
    "AV"
  ],
  "evidence": [
    {
      "paragraph": 6,
      "quote": "The valves between the atria and ventricles are called the atrioventricular valves"
    }
  ],
  "explanation": "Your notes call them the atrioventricular (AV) valves."
}
```

```json
{ "passes": true, "blocking": [], "advisory": [] }
```

`notChecked` in the result reminds the agent that the tools did not judge whether this is a good question, and did not run a blind review.

## 5. Checking the whole quiz

A second question, written alone, also passes `check_question`:

<!-- example:twin -->
```json
{
  "id": "v2",
  "conceptId": "valves-again",
  "role": "primary",
  "lockType": "rune-cipher",
  "caseSensitive": false,
  "prompt": "According to your notes, the tricuspid and mitral valves are both ______ valves.",
  "answer": "atrioventricular",
  "aliases": [
    "AV"
  ],
  "evidence": [
    {
      "paragraph": 6,
      "quote": "The valves between the atria and ventricles are called the atrioventricular valves"
    }
  ],
  "explanation": "Your notes call them atrioventricular valves."
}
```

But asked together with the third draft, `check_quiz` fails both questions. They share an answer, and each leaks the other's answer in its text:

```json
{ "passes": false, "summary": { "total": 2, "passing": 0, "failing": 2, "blockingByCheckId": { "answer-leak-in-room": 2, "duplicate-answer-in-room": 2 } } }
```

The agent sets the twin aside and asks about a different fact in paragraph 9:

<!-- example:second -->
```json
{
  "id": "v3",
  "conceptId": "pacemaker",
  "role": "primary",
  "lockType": "rune-cipher",
  "prompt": "According to your notes, each heartbeat starts with an electrical signal from the ______ node.",
  "answer": "sinoatrial",
  "aliases": [],
  "caseSensitive": false,
  "evidence": [
    {
      "paragraph": 9,
      "quote": "Each heartbeat starts with an electrical signal from the sinoatrial node"
    }
  ],
  "explanation": "Your notes say the signal starts in the sinoatrial node."
}
```

`check_quiz` on the third draft and this question: `"passes": true`, 2 of 2 passing. The agent presents the two questions with "Paragraph 6 of your notes" and "Paragraph 9 of your notes" and the quotes, lists the twin as set aside with `duplicate-answer-in-room`, and says what was not checked.
