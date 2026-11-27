import { createElement } from 'react';
import { describe, expect, it } from 'vitest';
import { ENTER_CRYPT_LABEL } from '@escape-the-crypt/core';
import { useRoomBinding } from '../../state/room-binding';
import type { RoomBinding } from '../../state/room-binding';
import { buildSampleCrypt } from '../../state/sample-crypt-source';
import { clickButton, useMount } from '../../test-support/flow-dom';
import { SAVE_BANNER_TEXT } from '../start/save-banner';
import { CryptFlow } from './crypt-flow';

function withSaveFailed(saveFailed: boolean): () => RoomBinding {
  return () => ({ ...useRoomBinding(buildSampleCrypt), saveFailed });
}

describe('CryptFlow save banner', () => {
  const mount = useMount();

  it('shows the banner in the flow above the room when saving failed', async () => {
    mount.render(createElement(CryptFlow, { useBinding: withSaveFailed(true) }));
    await clickButton(mount.container, ENTER_CRYPT_LABEL);
    const banner = mount.container.querySelector('[data-testid="save-banner"]');
    expect(banner?.textContent).toContain(SAVE_BANNER_TEXT);
    expect(banner?.closest('[data-testid="question-panel"], [data-testid="evidence-panel"]')).toBeNull();
  });

  it('shows no banner text when saving works', async () => {
    mount.render(createElement(CryptFlow, { useBinding: withSaveFailed(false) }));
    await clickButton(mount.container, ENTER_CRYPT_LABEL);
    expect(mount.container.textContent).not.toContain(SAVE_BANNER_TEXT);
  });
});
