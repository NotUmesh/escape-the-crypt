import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { chunkDocument } from '@escape-the-crypt/core';
import type { Chunk } from '@escape-the-crypt/core';
import { checkedNotices } from './generated-notices';
import type { WorkerNotices } from './generated-notices';

const NOTES =
  'The tides rise and fall twice a day in most places on the coast.\n\n' +
  'Spring tides happen when the Sun, Moon and Earth line up with each other.\n\n' +
  'A full tidal cycle takes about twelve hours and twenty five minutes to finish.';

const chunkMap = (text: string): ReadonlyMap<string, Chunk> =>
  new Map(chunkDocument({ sourceType: 'paste', text, originalText: text }).map((chunk) => [chunk.id, chunk]));

const CHUNKS = chunkMap(NOTES);
const [FIRST, SECOND] = [...CHUNKS.values()];
if (FIRST === undefined || SECOND === undefined) throw new Error('the fixture notes need two chunks');

const notice = (overrides: Partial<WorkerNotices['excluded'][number]> = {}): WorkerNotices => ({
  excluded: [
    {
      conceptId: 'c1',
      conceptTitle: 'How often the tides rise',
      source: 'model',
      passages: [
        { chunkId: FIRST.id, quote: 'The tides rise and fall twice a day' },
        { chunkId: SECOND.id, quote: 'Spring tides happen when the Sun, Moon and Earth line up' },
      ],
      ...overrides,
    },
  ],
  sufficiency: null,
});

describe('checkedNotices', () => {
  it('says nothing when there is nothing to say', () => {
    expect(checkedNotices(undefined, CHUNKS)).toBeUndefined();
    expect(checkedNotices({ excluded: [], sufficiency: null }, CHUNKS)).toBeUndefined();
  });

  it('keeps both passages, with a citation label from the learner\'s own chunks', () => {
    const result = checkedNotices(notice(), CHUNKS);
    expect(result?.leftOut).toHaveLength(1);
    const concept = result?.leftOut[0];
    expect(concept?.title).toBe('How often the tides rise');
    expect(concept?.passages.map((p) => p.quote)).toEqual([
      'The tides rise and fall twice a day',
      'Spring tides happen when the Sun, Moon and Earth line up',
    ]);
    expect(concept?.passages.map((p) => p.citationLabel)).toEqual(['Paragraph 1 of your notes', 'Paragraph 2 of your notes']);
  });

  it('still lists the concept, with no passages, when a passage cites a chunk that is not the learner\'s', () => {
    const foreign = notice({
      passages: [
        { chunkId: FIRST.id, quote: 'The tides rise and fall twice a day' },
        { chunkId: 'chk_not_yours_1', quote: 'Spring tides happen when the Sun, Moon and Earth line up' },
      ],
    });
    const concept = checkedNotices(foreign, CHUNKS)?.leftOut[0];
    expect(concept?.title).toBe('How often the tides rise');
    expect(concept?.passages).toEqual([]);
  });

  it('drops both passages when a quote is not in its chunk, or is too short to point anywhere', () => {
    for (const quote of ['A sentence that is nowhere in these notes at all', 'twice a day']) {
      const bad = notice({
        passages: [
          { chunkId: FIRST.id, quote },
          { chunkId: SECOND.id, quote: 'Spring tides happen when the Sun, Moon and Earth line up' },
        ],
      });
      expect(checkedNotices(bad, CHUNKS)?.leftOut[0]?.passages, quote).toEqual([]);
    }
  });

  it('shows the edited-PDF wording for an edited PDF chunk', () => {
    const pdf: Chunk = { ...FIRST, location: { sourceType: 'pdf', pdfPageIndex: 4, printedPageLabel: null }, edited: true };
    const label = checkedNotices(notice(), new Map([...CHUNKS, [pdf.id, pdf]]))?.leftOut[0]?.passages[0]?.citationLabel;
    expect(label).toBe('Your edited notes, originally extracted from PDF page 5');
  });

  it('keeps a title that looks like markup as plain text, unchanged', () => {
    const title = '<img src=x onerror=alert(1)> & "quoted"';
    expect(checkedNotices(notice({ conceptTitle: title }), CHUNKS)?.leftOut[0]?.title).toBe(title);
  });

  it('never throws on a hostile notice', () => {
    const hostile = { excluded: [{ conceptId: 'c', conceptTitle: 't', source: 'code', passages: [{ chunkId: '__proto__', quote: 'constructor' }, { chunkId: 'toString', quote: 'x' }] }], sufficiency: null } as unknown as WorkerNotices;
    expect(checkedNotices(hostile, CHUNKS)?.leftOut[0]?.passages).toEqual([]);
  });
});

describe('the recorded worker notice', () => {
  const FIXTURE = join(process.cwd(), '..', '..', 'packages', 'core', 'src', 'test-support', 'contract', 'job-completed.json');
  const recorded = JSON.parse(readFileSync(FIXTURE, 'utf8')) as { notices: { response: { bundle: { notices: WorkerNotices } } } };
  const worker = recorded.notices.response.bundle.notices;

  it('drops its passages for notes it was not made from', () => {
    const concept = checkedNotices(worker, CHUNKS)?.leftOut[0];
    expect(concept?.title).toBe('Time for the Moon to orbit Earth');
    expect(concept?.passages).toEqual([]);
  });

  it('shows both of its passages for the notes it was made from', () => {
    const moonNotes = readFileSync(join(process.cwd(), '..', '..', 'eval', 'adversarial', 'notes', 'adv-01-moon.txt'), 'utf8');
    const concept = checkedNotices(worker, chunkMap(moonNotes))?.leftOut[0];
    expect(concept?.passages.map((p) => p.quote)).toEqual([
      'The Moon takes about 27 days to orbit Earth.',
      'One orbit of the Moon around Earth takes about 35 days.',
    ]);
  });
});
