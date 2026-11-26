import { createElement } from 'react';
import { describe, expect, it } from 'vitest';
import {
  BANNED_COPY_PHRASES,
  FINAL_DOOR_STATUS_LABELS,
  ROOM_PLAY_LABELS,
} from '@escape-the-crypt/core';
import type { CryptContent, FinalDoorSlotState, SlotStatus, State } from '@escape-the-crypt/core';
import { useMount } from '../../test-support/flow-dom';
import { FinalDoorSection } from './final-door-section';

const STATUSES: readonly SlotStatus[] = ['open', 'solved', 'settled', 'challenged'];
const PROMPT = 'According to your notes, <b>what</b> & "why"?';

const slot = (id: string, status: SlotStatus): FinalDoorSlotState => ({
  slotId: id,
  origin: 'reserved',
  conceptId: 'k1',
  returnNumber: null,
  currentQuestionId: `q-${id}`,
  currentQuestionType: 'rune-cipher',
  label: null,
  status,
  candleLit: status === 'solved',
  appliedHint: null,
  evidencePanelOpen: false,
});

const state = { finalDoor: { slots: STATUSES.map((s) => slot(s, s)) } } as unknown as State;
const content = {
  questions: Object.fromEntries(STATUSES.map((s) => [`q-${s}`, { prompt: `${PROMPT} ${s}` }])),
} as unknown as CryptContent;

describe('FinalDoorSection', () => {
  const mount = useMount();

  function items(): Element[] {
    mount.render(createElement(FinalDoorSection, { state, content }));
    return Array.from(mount.container.querySelectorAll('li'));
  }

  it('lists every door question with its prompt as plain text', () => {
    const list = items();
    expect(list).toHaveLength(STATUSES.length);
    list.forEach((item, i) => {
      expect(item.querySelector('.autopsy-final-door__prompt')?.textContent).toBe(`${PROMPT} ${STATUSES[i]}`);
      expect(item.querySelector('b')).toBeNull();
    });
  });

  it.each(STATUSES)('shows the %s label and an aria-hidden icon', (status) => {
    const item = items().find((el) => el.getAttribute('data-status') === status);
    expect(item?.querySelector('.autopsy-outcome__label')?.textContent).toBe(FINAL_DOOR_STATUS_LABELS[status]);
    const svg = item?.querySelector('svg');
    expect(svg?.getAttribute('aria-hidden')).toBe('true');
  });

  it('draws a different icon for each status', () => {
    const shapes = items().map((el) => el.querySelector('svg')?.innerHTML);
    expect(new Set(shapes).size).toBe(STATUSES.length);
  });

  it('states the exclusion only for settled and challenged', () => {
    for (const item of items()) {
      const status = item.getAttribute('data-status') as SlotStatus;
      const excluded = status === 'settled' || status === 'challenged';
      expect(item.textContent?.includes(ROOM_PLAY_LABELS.autopsyExcludedStatement)).toBe(excluded);
    }
  });

  it('uses no banned phrases', () => {
    items();
    const text = (mount.container.textContent ?? '').toLowerCase();
    for (const phrase of BANNED_COPY_PHRASES) expect(text).not.toContain(phrase.toLowerCase());
  });
});
