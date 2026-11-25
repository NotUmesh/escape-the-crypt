import { act } from 'react';
import { createRoot } from 'react-dom/client';
import type { Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { LiveRegion } from './live-region';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

const render = (messages: readonly string[]): void => {
  act(() => {
    root.render(<LiveRegion messages={messages} intervalMs={1000} />);
  });
};
const text = (): string => container.querySelector('[aria-live]')?.textContent ?? '';

beforeEach(() => {
  vi.useFakeTimers();
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.useRealTimers();
});

describe('LiveRegion', () => {
  it('renders exactly one polite live region', () => {
    render([]);
    const regions = container.querySelectorAll('[aria-live]');
    expect(regions).toHaveLength(1);
    expect(regions[0]?.getAttribute('aria-live')).toBe('polite');
  });

  it('shows queued messages one at a time, never merged', () => {
    render(['first', 'second', 'third']);
    expect(text()).toBe('first');
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(text()).toBe('second');
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(text()).toBe('third');
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(text()).toBe('');
  });

  it('appends a later batch behind the message on show', () => {
    render(['one']);
    render(['two']);
    expect(text()).toBe('one');
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(text()).toBe('two');
  });
});
