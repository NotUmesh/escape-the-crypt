/** The tools the server lists. Descriptions are written for the agent that calls them. */
export interface ToolDefinition {
  readonly name: string;
  readonly description: string;
  readonly inputSchema: Readonly<Record<string, unknown>>;
}

const notesId = { type: 'string', description: 'The notesId returned by prepare_notes.' } as const;

export const TOOL_DEFINITIONS: readonly ToolDefinition[] = [
  {
    name: 'prepare_notes',
    description:
      "Splits the learner's notes (up to 6,000 words) into numbered paragraphs and returns each paragraph's text with a notesId. Questions must cite these paragraph numbers. Heading-only lines are listed under `headings` and cannot be quoted. Notes stay in this server's memory only and are forgotten when it stops.",
    inputSchema: {
      type: 'object',
      properties: { text: { type: 'string', description: 'The full text of the notes.' } },
      required: ['text'],
      additionalProperties: false,
    },
  },
  {
    name: 'resolve_quote',
    description:
      'Checks that an exact quote appears exactly once in one paragraph of the prepared notes, after normalising whitespace, curly quotes, ligatures and line-break hyphens. Returns the matched text and its place, or the reason it failed with advice. Quotes must be 4 to 25 words and at least 20 characters.',
    inputSchema: {
      type: 'object',
      properties: {
        notesId,
        paragraph: { type: 'integer', minimum: 1, description: 'Paragraph number from prepare_notes.' },
        quote: { type: 'string', description: 'The words to find, copied from the paragraph.' },
      },
      required: ['notesId', 'paragraph', 'quote'],
      additionalProperties: false,
    },
  },
  {
    name: 'check_question',
    description:
      'Runs the evidence code checks on one drafted question (rune-cipher, seance-board, bone-ordering, bound-threads or cursed-object): quotes resolve, the answer is in the quote, nothing leaks the answer, no negative question, choice options are supported or contradicted, and more. Returns blocking and advisory findings with advice. See references/question-formats.md for the question shape.',
    inputSchema: {
      type: 'object',
      properties: {
        notesId,
        question: { type: 'object', description: 'One question in the authoring format.' },
      },
      required: ['notesId', 'question'],
      additionalProperties: false,
    },
  },
  {
    name: 'check_quiz',
    description:
      'Runs every check on a set of 1 to 40 drafted questions, including the checks that compare questions: an answer leaked into another question, two questions with the same answer, and primary/alternate pairs. Use it before presenting a quiz.',
    inputSchema: {
      type: 'object',
      properties: {
        notesId,
        questions: { type: 'array', items: { type: 'object' }, minItems: 1, maxItems: 40, description: 'Questions in the authoring format.' },
      },
      required: ['notesId', 'questions'],
      additionalProperties: false,
    },
  },
  {
    name: 'normalise_text',
    description:
      'Shows the normalised form of a piece of text: the exact string the quote resolver compares. Useful when a quote fails because of curly quotes, a ligature, or a hyphen at a line break.',
    inputSchema: {
      type: 'object',
      properties: { text: { type: 'string' } },
      required: ['text'],
      additionalProperties: false,
    },
  },
  {
    name: 'list_checks',
    description: 'Lists every check this Power can report, with the check version, the quote rules and advice for each check.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
];
