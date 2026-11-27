# Question formats

Every question is one JSON object. Fields not listed here are rejected, and no field takes a character offset: code finds where each quote sits. The examples below are real questions from `samples/questions/human-heart.json` and pass `check_question` against `samples/human-heart.txt`.

## Fields every question has

| Field | Meaning |
| --- | --- |
| `id` | Unique within the quiz, for example `q1` |
| `conceptId` | The idea the question tests. Two questions on one concept are a primary and an alternate |
| `role` | `primary`, or `alternate` (a second question on the same concept, of a different lock type; at most one) |
| `lockType` | `rune-cipher`, `seance-board`, `bone-ordering`, `bound-threads` or `cursed-object` |
| `prompt` | The question text. Positive wording. Choice questions start "According to your notes" |
| `explanation` | One or two sentences that say what the notes say. Plain text |
| `note` | Optional. Free text for the author, never shown as evidence |

An evidence item is `{ "paragraph": N, "quote": "…" }`: a paragraph number from `prepare_notes` and an exact quote of 4 to 25 words (at least 20 characters) from that paragraph.

## rune-cipher: fill in one blank

Extra fields: `answer`, `aliases` (other accepted spellings; may be empty), `caseSensitive`, `evidence` (at least one item), optional `hint`. The prompt has exactly one blank (a run of underscores). The answer, or an alias, must appear in a quote. The answer must not appear in the prompt.

<!-- format:rune-cipher -->
```json
{
  "id": "hh-q01",
  "conceptId": "hh-c01",
  "role": "primary",
  "lockType": "rune-cipher",
  "prompt": "According to your notes, the valves between the atria and ventricles are called the ______ valves.",
  "answer": "atrioventricular",
  "aliases": [
    "AV"
  ],
  "caseSensitive": false,
  "evidence": [
    {
      "paragraph": 6,
      "quote": "The valves between the atria and ventricles are called the atrioventricular valves, or AV valves"
    }
  ],
  "explanation": "Your notes call them the atrioventricular (AV) valves: the tricuspid on the right and the mitral on the left.",
  "hint": {
    "kind": "first-letter-and-length",
    "firstLetter": "a",
    "length": 16
  }
}
```

## seance-board: choose from 3 or 4 options

Extra fields: `options` (3 or 4), `answer` (the id of the supported option). Each option has `id`, `text`, `label` (`supported` or `contradicted`) and its own `evidence`. Exactly one option is `supported`, and it is the `answer`. The other options must be contradicted by their quotes. There is no label for "not mentioned": an option the notes do not address cannot be used.

<!-- format:seance-board -->
```json
{
  "id": "hh-q03",
  "conceptId": "hh-c02",
  "role": "primary",
  "lockType": "seance-board",
  "prompt": "According to your notes, which chamber pumps oxygen-rich blood to the body?",
  "options": [
    {
      "id": "a",
      "text": "Right atrium",
      "label": "contradicted",
      "evidence": {
        "paragraph": 4,
        "quote": "The right atrium receives oxygen-poor blood returning from the body."
      }
    },
    {
      "id": "b",
      "text": "Left ventricle",
      "label": "supported",
      "evidence": {
        "paragraph": 5,
        "quote": "The left ventricle pumps oxygen-rich blood out to the rest of the body."
      }
    },
    {
      "id": "c",
      "text": "Right ventricle",
      "label": "contradicted",
      "evidence": {
        "paragraph": 4,
        "quote": "The right ventricle pumps that blood to the lungs"
      }
    },
    {
      "id": "d",
      "text": "Left atrium",
      "label": "contradicted",
      "evidence": {
        "paragraph": 5,
        "quote": "The left atrium receives oxygen-rich blood from the lungs."
      }
    }
  ],
  "answer": "b",
  "explanation": "The left ventricle pumps oxygen-rich blood to the body; the other chambers receive blood or pump it to the lungs."
}
```

## bone-ordering: put steps in order

Extra fields: `steps` (3 to 5, in the correct order) and `evidence` (at least one item). At least one quote must state the order outright with wording such as "first", "next", "then", "finally" or numbering. If the notes do not say the order, do not ask for it.

<!-- format:bone-ordering -->
```json
{
  "id": "hh-q05",
  "conceptId": "hh-c03",
  "role": "primary",
  "lockType": "bone-ordering",
  "prompt": "According to your notes, put the path of blood through the right side of the heart in order.",
  "steps": [
    "Right atrium",
    "Tricuspid valve",
    "Right ventricle",
    "Pulmonary valve"
  ],
  "evidence": [
    {
      "paragraph": 7,
      "quote": "First, it enters the right atrium."
    },
    {
      "paragraph": 7,
      "quote": "Finally, it is pumped through the pulmonary valve towards the lungs."
    }
  ],
  "explanation": "Paragraph 7 gives the order: first, next, then, finally."
}
```

## bound-threads: match 3 or 4 pairs

Extra field: `pairs` (3 or 4). Each pair has `left`, `right` and its own `evidence` item. The matching is strictly one to one: no left item and no right item is used twice. Each pair's quote must state that pairing. Optional `hint` is added by code in the app, so leave it out.

<!-- format:bound-threads -->
```json
{
  "id": "hh-q07",
  "conceptId": "hh-c04",
  "role": "primary",
  "lockType": "bound-threads",
  "prompt": "According to your notes, connect each blood vessel to its job.",
  "pairs": [
    {
      "left": "Aorta",
      "right": "Carries blood to the body",
      "evidence": {
        "paragraph": 8,
        "quote": "The aorta carries blood to the body."
      }
    },
    {
      "left": "Pulmonary artery",
      "right": "Carries blood to the lungs",
      "evidence": {
        "paragraph": 8,
        "quote": "The pulmonary artery carries blood to the lungs."
      }
    },
    {
      "left": "Vena cava",
      "right": "Returns blood to the heart",
      "evidence": {
        "paragraph": 8,
        "quote": "The vena cava returns blood to the heart from the body."
      }
    }
  ],
  "explanation": "Paragraph 8 gives each vessel one job."
}
```

## cursed-object: find the odd one out

Extra fields: `items` (exactly 4), `answer` (the exact text of the odd item), `categoryRule` (a sentence of at least 10 characters that states what the other three have in common) and `evidence` (top-level, at least two quotes). One quote must set the category; a different quote must place the odd item outside it, with wording such as "not", "unlike" or "outside", or by naming the odd item. This is the one lock type whose prompt may read "Which one is not …".

<!-- format:cursed-object -->
```json
{
  "id": "hh-q09",
  "conceptId": "hh-c05",
  "role": "primary",
  "lockType": "cursed-object",
  "prompt": "According to your notes, three of these are chambers of the heart. Which one is not?",
  "items": [
    "Left atrium",
    "Right ventricle",
    "Aorta",
    "Right atrium"
  ],
  "answer": "Aorta",
  "categoryRule": "The heart's four chambers are the right and left atria and the right and left ventricles.",
  "evidence": [
    {
      "paragraph": 3,
      "quote": "The two upper chambers are the right atrium and the left atrium."
    },
    {
      "paragraph": 3,
      "quote": "The aorta is not a chamber of the heart"
    }
  ],
  "explanation": "Your notes say the aorta is the largest artery, not a chamber."
}
```

## Not supported here

Combination dial questions exist in the Escape the Crypt app but have no checks in this Power yet. `check_question` reports them as not valid for this Power.
