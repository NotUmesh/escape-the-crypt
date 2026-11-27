import { createElement } from 'react';
import { IDBFactory } from 'fake-indexeddb';
import { describe, expect, it } from 'vitest';
import { ENTER_CRYPT_LABEL } from '@escape-the-crypt/core';
import { createIdbStore } from '../ingest/notes-store-idb';
import { useRoomBinding } from '../../state/room-binding';
import type { RoomBinding } from '../../state/room-binding';
import { buildSampleCrypt } from '../../state/sample-crypt-source';
import type { RunLockState } from '../../state/storage/run-lock';
import { useMount } from '../../test-support/flow-dom';
import { CryptFlow } from './crypt-flow';

const factory = new IDBFactory();
const restoreDeps = { factory, notesStore: createIdbStore(factory) };

function withLock(lockState: RunLockState | undefined): () => RoomBinding {
  return () => ({
    ...useRoomBinding(buildSampleCrypt),
    runId: 'run-ro',
    takeOver: async () => undefined,
    ...(lockState === undefined ? {} : { lockState }),
  });
}

const screen = (root: ParentNode): Element | null => root.querySelector('[data-testid="read-only-screen"]');

describe('CryptFlow read-only screen', () => {
  const mount = useMount();

  it.each<RunLockState>(['waiting', 'lost'])('shows the read-only screen when the lock is %s', (state) => {
    mount.render(createElement(CryptFlow, { useBinding: withLock(state), restoreDeps }));
    expect(screen(mount.container)).not.toBeNull();
    expect(mount.container.textContent).not.toContain(ENTER_CRYPT_LABEL);
  });

  it.each<RunLockState | undefined>(['held', 'single-tab', 'acquiring', undefined])(
    'shows the normal screen when the lock is %s',
    (state) => {
      mount.render(createElement(CryptFlow, { useBinding: withLock(state), restoreDeps }));
      expect(screen(mount.container)).toBeNull();
      expect(mount.container.textContent).toContain(ENTER_CRYPT_LABEL);
    },
  );
});
