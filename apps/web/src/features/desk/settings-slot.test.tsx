import { act } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { RUN_SETUP_COPY, lengthAvailability } from '@escape-the-crypt/core';
import { useMount } from '../../test-support/flow-dom';
import { DEFAULT_RUN_CHOICE, effectiveLength, settingsForChoice } from './run-choice';
import type { RunChoice } from './run-choice';
import { SettingsSlot } from './settings-slot';

const radios = (root: ParentNode, legend: string): HTMLInputElement[] => {
  const fieldset = Array.from(root.querySelectorAll('fieldset')).find((f) => f.querySelector('legend')?.textContent === legend);
  return Array.from(fieldset?.querySelectorAll<HTMLInputElement>('input[type="radio"]') ?? []);
};
const labelOf = (input: HTMLInputElement): string =>
  input.closest('label')?.querySelector('.run-settings__label')?.textContent ?? '';

describe('SettingsSlot', () => {
  const mount = useMount();
  const all = lengthAvailability(8);
  const thin = lengthAvailability(3);

  it('renders nothing without a value and a change handler', () => {
    mount.render(<SettingsSlot />);
    expect(mount.container.innerHTML).toBe('');
  });

  it('offers length and difficulty as two native radio groups, defaulting to Short and Apprentice', () => {
    mount.render(<SettingsSlot value={DEFAULT_RUN_CHOICE} onChange={() => undefined} availability={all} />);
    const lengths = radios(mount.container, RUN_SETUP_COPY.lengthLegend);
    const difficulties = radios(mount.container, RUN_SETUP_COPY.difficultyLegend);
    expect(lengths.map(labelOf)).toEqual(['Short', 'Standard', 'Long']);
    expect(difficulties.map(labelOf)).toEqual(['Apprentice', 'Gravedigger', 'Lich']);
    expect(lengths.filter((r) => r.checked).map(labelOf)).toEqual(['Short']);
    expect(difficulties.filter((r) => r.checked).map(labelOf)).toEqual(['Apprentice']);
    // One name per group, so the arrow keys move within it and Tab reaches each group once.
    expect(new Set(lengths.map((r) => r.name)).size).toBe(1);
    expect(new Set(difficulties.map((r) => r.name)).size).toBe(1);
    expect(lengths[0]?.name).not.toBe(difficulties[0]?.name);
  });

  it('describes every option and each group with real text', () => {
    mount.render(<SettingsSlot value={DEFAULT_RUN_CHOICE} onChange={() => undefined} availability={all} />);
    for (const input of mount.container.querySelectorAll<HTMLInputElement>('input[type="radio"]')) {
      const described = document.getElementById(input.getAttribute('aria-describedby') ?? '');
      expect(described?.textContent?.length).toBeGreaterThan(0);
    }
    for (const fieldset of mount.container.querySelectorAll('fieldset')) {
      expect(document.getElementById(fieldset.getAttribute('aria-describedby') ?? '')).not.toBeNull();
    }
    expect(mount.container.textContent).toContain('3 hints. Rune tablets show how many letters the answer has.');
    expect(mount.container.textContent).toContain('No hints. Rune tablets keep the letter count to themselves.');
  });

  it('reports a change through onChange', () => {
    const onChange = vi.fn();
    mount.render(<SettingsSlot value={DEFAULT_RUN_CHOICE} onChange={onChange} availability={all} />);
    act(() => radios(mount.container, RUN_SETUP_COPY.lengthLegend)[2]?.click());
    expect(onChange).toHaveBeenLastCalledWith({ length: 'long', difficulty: 'apprentice' });
    act(() => radios(mount.container, RUN_SETUP_COPY.difficultyLegend)[2]?.click());
    expect(onChange).toHaveBeenLastCalledWith({ length: 'short', difficulty: 'lich' });
  });

  it('disables lengths the notes clearly cannot fill, with a one-line reason', () => {
    mount.render(<SettingsSlot value={DEFAULT_RUN_CHOICE} onChange={() => undefined} availability={thin} />);
    const lengths = radios(mount.container, RUN_SETUP_COPY.lengthLegend);
    expect(lengths.map((r) => r.disabled)).toEqual([false, true, true]);
    expect(mount.container.textContent).toContain('Your notes are short enough for a Short crypt.');
    // Switched-off state is in the text styling and the disabled attribute, not colour alone.
    expect(lengths[1]?.closest('label')?.hasAttribute('data-disabled')).toBe(true);
  });

  it('shows a chosen length that is switched off as the largest one offered', () => {
    const chosen: RunChoice = { length: 'long', difficulty: 'gravedigger' };
    mount.render(<SettingsSlot value={chosen} onChange={() => undefined} availability={thin} />);
    expect(radios(mount.container, RUN_SETUP_COPY.lengthLegend).filter((r) => r.checked).map(labelOf)).toEqual(['Short']);
  });

  it('hides the length choice when there is nothing to generate (the sample has a fixed size)', () => {
    mount.render(<SettingsSlot value={DEFAULT_RUN_CHOICE} onChange={() => undefined} availability={null} />);
    expect(mount.container.querySelectorAll('fieldset')).toHaveLength(1);
    expect(mount.container.querySelector('legend')?.textContent).toBe(RUN_SETUP_COPY.difficultyLegend);
  });
});

describe('run choice', () => {
  it('never sends a switched-off length', () => {
    expect(effectiveLength({ length: 'long', difficulty: 'lich' }, lengthAvailability(2))).toBe('short');
    expect(effectiveLength({ length: 'standard', difficulty: 'lich' }, lengthAvailability(9))).toBe('standard');
  });

  it('gives a generated crypt the chosen length and the sample its fixed Short', () => {
    const choice: RunChoice = { length: 'long', difficulty: 'gravedigger' };
    expect(settingsForChoice(choice, lengthAvailability(9), 'generated')).toEqual({ length: 'long', difficulty: 'gravedigger', hintAllowance: 2 });
    expect(settingsForChoice(choice, lengthAvailability(9), 'sample')).toEqual({ length: 'short', difficulty: 'gravedigger', hintAllowance: 2 });
  });
});
