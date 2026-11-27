import { describe, expect, it } from 'vitest';
import type { ReactNode } from 'react';
import { useMount } from '../../test-support/flow-dom';
import { LockPayloadContext, useLockPayload } from './lock-panel-payload';

function Probe({ type }: { type: 'bone-ordering' | 'cursed-object' }): ReactNode {
  const payload = useLockPayload('s1', 'q1', type);
  return <span data-testid="out">{payload === null ? 'none' : 'some'}</span>;
}
describe('useLockPayload', () => {
  const mount = useMount();
  const text = (): string => mount.container.querySelector('[data-testid="out"]')?.textContent ?? '';
  it('returns the payload for the matching type', () => {
    mount.render(
      <LockPayloadContext.Provider value={{ payloadFor: () => ({ itemIds: ['a'], keyOrder: ['a'] }) }}>
        <Probe type="bone-ordering" />
      </LockPayloadContext.Provider>,
    );
    expect(text()).toBe('some');
  });
  it('returns null for another type, a missing payload and no provider', () => {
    mount.render(
      <LockPayloadContext.Provider value={{ payloadFor: () => ({ itemIds: ['a'], keyOrder: ['a'] }) }}>
        <Probe type="cursed-object" />
      </LockPayloadContext.Provider>,
    );
    expect(text()).toBe('none');
    mount.render(
      <LockPayloadContext.Provider value={{ payloadFor: () => undefined }}>
        <Probe type="bone-ordering" />
      </LockPayloadContext.Provider>,
    );
    expect(text()).toBe('none');
    mount.render(<Probe type="bone-ordering" />);
    expect(text()).toBe('none');
  });
});
