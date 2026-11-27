import { describe, expect, it, vi } from 'vitest';
import { apply, initial } from '@escape-the-crypt/core';
import type { Event } from '@escape-the-crypt/core';
import { buildSampleCrypt } from '../../state/sample-crypt-source';
import { useMount } from '../../test-support/flow-dom';
import { ReadOnlyScreen } from './read-only-screen';

function sampleState() {
  const built = buildSampleCrypt();
  if (!built.ok) throw new Error('sample failed');
  const { manifest } = built.value;
  let state = initial(manifest, { length: 'short', difficulty: 'apprentice', hintAllowance: 2 });
  const first = manifest.rooms[0];
  if (first === undefined) throw new Error('no room');
  const events: Event[] = [
    { kind: 'RunStarted', manifestId: manifest.manifestId },
    ...manifest.rooms.map((r): Event => ({ kind: 'RoomPublished', roomId: r.roomId })),
    { kind: 'CryptFinalised', finalRoomCount: manifest.rooms.length },
    { kind: 'RoomEntered', roomId: first.roomId },
  ];
  for (const event of events) {
    const result = apply(state, event);
    if (!result.ok) throw new Error(`rejected ${event.kind}`);
    state = result.state;
  }
  return state;
}

describe('ReadOnlyScreen', () => {
  const mount = useMount();

  it('shows the text, focuses Take over here, and offers no lock to open', () => {
    const onTakeOver = vi.fn();
    mount.render(<ReadOnlyScreen state={sampleState()} onTakeOver={onTakeOver} />);
    const root = mount.container;
    expect(root.textContent).toContain('This crypt is open in another tab');
    const button = root.querySelector<HTMLButtonElement>('.read-only-screen__take-over');
    expect(button?.textContent).toBe('Take over here');
    expect(document.activeElement).toBe(button);

    const locks = root.querySelectorAll('[data-testid="read-only-locks"] li');
    expect(locks.length).toBeGreaterThan(0);
    // The only button on the screen is Take over here, and no lock element has a click handler.
    expect(root.querySelectorAll('button')).toHaveLength(1);
    expect(root.querySelectorAll('[data-testid="read-only-locks"] button, [role="button"]')).toHaveLength(0);
    locks.forEach((li) => li.dispatchEvent(new MouseEvent('click', { bubbles: true })));
    expect(onTakeOver).not.toHaveBeenCalled();

    button?.click();
    expect(onTakeOver).toHaveBeenCalledTimes(1);
  });
});
