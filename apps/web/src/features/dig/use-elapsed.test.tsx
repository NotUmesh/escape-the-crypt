import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useMount } from '../../test-support/flow-dom';
import { useElapsed } from './use-elapsed';

function Probe({ active, now }: { readonly active: boolean; readonly now: () => number }): React.JSX.Element {
  return <p data-testid="s">{useElapsed(active, now)}</p>;
}

describe('useElapsed', () => {
  const mount = useMount();
  let time = 0;
  const now = (): number => time;
  const shown = (): string => mount.container.querySelector('[data-testid="s"]')?.textContent ?? '';
  const advance = (ms: number): void => {
    time += ms;
    act(() => vi.advanceTimersByTime(ms));
  };

  beforeEach(() => {
    vi.useFakeTimers();
    time = 1_000_000;
  });
  afterEach(() => vi.useRealTimers());

  it('is 0 before it starts', () => {
    mount.render(<Probe active={false} now={now} />);
    expect(shown()).toBe('0');
  });

  it('counts whole seconds from the clock while active', () => {
    mount.render(<Probe active now={now} />);
    advance(1000);
    expect(shown()).toBe('1');
    advance(41_000);
    expect(shown()).toBe('42');
  });

  it('follows the clock, not the number of ticks (a throttled tab catches up)', () => {
    mount.render(<Probe active now={now} />);
    // One timer tick fires, but the clock has moved 90 s: the count follows the clock.
    time += 90_000;
    act(() => vi.advanceTimersByTime(1000));
    expect(shown()).toBe('90');
  });

  it('holds the last value when the job ends', () => {
    mount.render(<Probe active now={now} />);
    advance(5000);
    mount.render(<Probe active={false} now={now} />);
    advance(30_000);
    expect(shown()).toBe('5');
  });

  it('starts again from 0 for the next job', () => {
    mount.render(<Probe active now={now} />);
    advance(5000);
    mount.render(<Probe active={false} now={now} />);
    mount.render(<Probe active now={now} />);
    expect(shown()).toBe('0');
    advance(2000);
    expect(shown()).toBe('2');
  });

  it('never goes negative if the clock steps back', () => {
    mount.render(<Probe active now={now} />);
    time -= 10_000;
    act(() => vi.advanceTimersByTime(1000));
    expect(shown()).toBe('0');
  });
});
