import { act } from 'react';
import { describe, expect, it } from 'vitest';
import { useMount } from '../../test-support/flow-dom';
import { ShellAnnouncer, useShellAnnouncer } from './shell-announcer';

function Host(): React.JSX.Element {
  const { message, announce } = useShellAnnouncer();
  return (
    <>
      <button type="button" onClick={() => announce('Stopped. Your notes are still here.')}>
        say
      </button>
      <button type="button" onClick={() => announce('')}>
        clear
      </button>
      <ShellAnnouncer message={message} />
    </>
  );
}

describe('ShellAnnouncer', () => {
  const mount = useMount();

  it('is one polite status region, present and empty before any message', () => {
    mount.render(<ShellAnnouncer message="" />);
    const regions = mount.container.querySelectorAll('[aria-live], [role="status"]');
    expect(regions).toHaveLength(1);
    const region = regions[0] as HTMLElement;
    expect(region.getAttribute('aria-live')).toBe('polite');
    expect(region.getAttribute('role')).toBe('status');
    expect(region.getAttribute('aria-atomic')).toBe('true');
    expect(region.textContent).toBe('');
  });

  it('shows the latest message and clears it', () => {
    mount.render(<Host />);
    const region = mount.container.querySelector('[role="status"]') as HTMLElement;
    act(() => (mount.container.querySelectorAll('button')[0] as HTMLButtonElement).click());
    expect(region.textContent).toBe('Stopped. Your notes are still here.');
    act(() => (mount.container.querySelectorAll('button')[1] as HTMLButtonElement).click());
    expect(region.textContent).toBe('');
    expect(mount.container.querySelectorAll('[aria-live]')).toHaveLength(1);
  });
});
