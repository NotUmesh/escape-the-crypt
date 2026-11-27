import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useMount } from '../../test-support/flow-dom';
import { useDescentSequence } from './use-descent-sequence';
import type { DescentSequence } from './use-descent-sequence';

describe('useDescentSequence', () => {
  const mount = useMount();
  const onDone = vi.fn();
  let seq: DescentSequence;

  function Probe({ clipCount = 2, timeout = 1500 }: { readonly clipCount?: number; readonly timeout?: number }): null {
    seq = useDescentSequence({ clipCount, onDone, canPlayTimeoutMs: timeout });
    return null;
  }

  beforeEach(() => {
    vi.useFakeTimers();
    onDone.mockClear();
  });
  afterEach(() => vi.useRealTimers());

  it('moves to the next clip when one ends, then finishes after the last', () => {
    mount.render(<Probe />);
    expect(seq.index).toBe(0);
    act(() => seq.onCanPlay());
    act(() => seq.onEnded());
    expect(seq.index).toBe(1);
    expect(onDone).not.toHaveBeenCalled();
    act(() => seq.onCanPlay());
    act(() => seq.onEnded());
    expect(onDone).toHaveBeenCalledExactlyOnceWith('ended');
  });

  it('finishes at once when skipped, and only once', () => {
    mount.render(<Probe />);
    act(() => seq.skip());
    act(() => seq.skip());
    act(() => seq.onEnded());
    act(() => seq.onError());
    expect(onDone).toHaveBeenCalledExactlyOnceWith('skipped');
  });

  it('finishes on a media error', () => {
    mount.render(<Probe />);
    act(() => seq.onError());
    expect(onDone).toHaveBeenCalledExactlyOnceWith('error');
  });

  it('gives up on a clip that is not playable in time', () => {
    mount.render(<Probe timeout={1500} />);
    act(() => vi.advanceTimersByTime(1499));
    expect(onDone).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(1));
    expect(onDone).toHaveBeenCalledExactlyOnceWith('error');
  });

  it('does not give up on a clip that became playable, however long it runs', () => {
    mount.render(<Probe />);
    act(() => seq.onCanPlay());
    act(() => vi.advanceTimersByTime(60_000));
    expect(onDone).not.toHaveBeenCalled();
  });

  it('gives each clip its own wait', () => {
    mount.render(<Probe timeout={1500} />);
    act(() => seq.onCanPlay());
    act(() => seq.onEnded());
    act(() => vi.advanceTimersByTime(1499));
    expect(onDone).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(1));
    expect(onDone).toHaveBeenCalledExactlyOnceWith('error');
  });

  it('finishes after a single clip when there is only one', () => {
    mount.render(<Probe clipCount={1} />);
    act(() => seq.onCanPlay());
    act(() => seq.onEnded());
    expect(onDone).toHaveBeenCalledExactlyOnceWith('ended');
  });

  it('stops its timer when the gate unmounts', () => {
    mount.render(<Probe />);
    mount.render(<div />);
    act(() => vi.advanceTimersByTime(10_000));
    expect(onDone).not.toHaveBeenCalled();
  });
});
