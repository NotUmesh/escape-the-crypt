import { describe, expect, it } from 'vitest';
import type { ReactNode } from 'react';
import { useMount } from '../../test-support/flow-dom';
import { LockPanelContext } from './lock-panel-context';
import type { LockPanelContextValue } from './lock-panel-context';
import { useLockPayload } from './lock-panel-payload';

function Probe({ type }: { type: 'bone-ordering' | 'cursed-object' }): ReactNode {
  const payload = useLockPayload('s1', 'q1', type);
  return <span data-testid="out">{payload === null ? 'none' : 'some'}</span>;
}
function ctx(payloadFor?: (s: string, q: string) => unknown): LockPanelContextValue {
  return { dispatch: () => undefined, rejection: null, content: { questions: {}, concepts: {} }, appliedHintFor: () => null, payloadFor };
}
describe('useLockPayload', () => {
  const mount = useMount();
  const text = (): string => mount.container.querySelector('[data-testid="out"]')?.textContent ?? '';
  it('returns the payload for the matching type', () => {
    mount.render(
      <LockPanelContext.Provider value={ctx(() => ({ itemIds: ['a'], keyOrder: ['a'] }))}>
        <Probe type="bone-ordering" />
      </LockPanelContext.Provider>,
    );
    expect(text()).toBe('some');
  });
  it('returns null for another type, a missing payload and no provider', () => {
    mount.render(
      <LockPanelContext.Provider value={ctx(() => ({ itemIds: ['a'], keyOrder: ['a'] }))}>
        <Probe type="cursed-object" />
      </LockPanelContext.Provider>,
    );
    expect(text()).toBe('none');
    mount.render(
      <LockPanelContext.Provider value={ctx(() => undefined)}>
        <Probe type="bone-ordering" />
      </LockPanelContext.Provider>,
    );
    expect(text()).toBe('none');
    mount.render(
      <LockPanelContext.Provider value={ctx()}>
        <Probe type="bone-ordering" />
      </LockPanelContext.Provider>,
    );
    expect(text()).toBe('none');
    mount.render(<Probe type="bone-ordering" />);
    expect(text()).toBe('none');
  });
});
