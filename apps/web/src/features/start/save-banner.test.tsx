import { describe, expect, it } from 'vitest';
import { useMount } from '../../test-support/flow-dom';
import { SAVE_BANNER_TEXT, SaveBanner } from './save-banner';

describe('SaveBanner', () => {
  const mount = useMount();

  it('shows the exact text in a status region when saving failed', () => {
    mount.render(<SaveBanner saveFailed exportSlot={<button type="button">Export</button>} />);
    const region = mount.container.querySelector('[role="status"]');
    expect(region?.textContent).toContain(
      "Your progress isn't being saved on this device. Export a copy to keep it.",
    );
    expect(SAVE_BANNER_TEXT).toBe("Your progress isn't being saved on this device. Export a copy to keep it.");
    expect(region?.querySelector('button')?.textContent).toBe('Export');
  });

  it('keeps an empty status region when saving works', () => {
    mount.render(<SaveBanner saveFailed={false} />);
    const region = mount.container.querySelector('[role="status"]');
    expect(region).not.toBeNull();
    expect(region?.textContent).toBe('');
  });
});
