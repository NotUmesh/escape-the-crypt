import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useMount } from '../../test-support/flow-dom';
import { DescentGate } from './descent-gate';
import type { DescentGateProps } from './descent-gate';

function stubReducedMotion(reduced: boolean): void {
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: query.includes('prefers-reduced-motion') ? reduced : false,
    media: query,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  }));
}

describe('DescentGate', () => {
  const mount = useMount();
  const onDone = vi.fn();
  const announce = vi.fn();
  const gate = (variant: DescentGateProps['variant'] = 'clips'): React.JSX.Element => (
    <DescentGate variant={variant} onDone={onDone} announce={announce} />
  );
  const video = (): HTMLVideoElement | null => mount.container.querySelector('video');
  const fire = (target: Element | null, type: string): void => {
    act(() => {
      target?.dispatchEvent(new Event(type));
    });
  };

  beforeEach(() => {
    vi.useFakeTimers();
    onDone.mockClear();
    announce.mockClear();
    stubReducedMotion(false);
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  describe('clips', () => {
    it('shows the desk clip first, silent and decorative, with webm then mp4 and a poster', () => {
      mount.render(gate());
      const v = video() as HTMLVideoElement;
      expect(v.muted).toBe(true);
      expect(v.autoplay).toBe(true);
      expect(v.hasAttribute('controls')).toBe(false);
      expect(v.getAttribute('aria-hidden')).toBe('true');
      expect(v.getAttribute('poster')).toBe('/art/motion/descent-desk-poster.webp');
      expect(Array.from(v.querySelectorAll('source')).map((s) => [s.getAttribute('src'), s.getAttribute('type')])).toEqual([
        ['/art/motion/descent-desk.webm', 'video/webm'],
        ['/art/motion/descent-desk.mp4', 'video/mp4'],
      ]);
    });

    it('announces the descent once and puts focus on Skip at once', () => {
      mount.render(gate());
      expect(announce).toHaveBeenCalledExactlyOnceWith('Descending into the crypt.');
      const skip = mount.container.querySelector('.descent__skip') as HTMLButtonElement;
      expect(skip.textContent).toBe('Skip');
      expect(document.activeElement).toBe(skip);
    });

    it('is a labelled region', () => {
      mount.render(gate());
      const region = mount.container.querySelector('[data-testid="descent-gate"]');
      expect(region?.getAttribute('role')).toBe('region');
      expect(region?.getAttribute('aria-label')).toBe('Descending into the crypt');
    });

    it('plays the second clip after the first, then finishes', () => {
      mount.render(gate());
      fire(video(), 'canplay');
      fire(video(), 'ended');
      expect(video()?.getAttribute('poster')).toBe('/art/motion/descent-poster.webp');
      expect(video()?.querySelector('source')?.getAttribute('src')).toBe('/art/motion/descent.webm');
      expect(onDone).not.toHaveBeenCalled();
      fire(video(), 'canplay');
      fire(video(), 'ended');
      expect(onDone).toHaveBeenCalledExactlyOnceWith('ended');
    });

    it('finishes when Skip is pressed', () => {
      mount.render(gate());
      act(() => (mount.container.querySelector('.descent__skip') as HTMLButtonElement).click());
      expect(onDone).toHaveBeenCalledExactlyOnceWith('skipped');
    });

    it('finishes on Escape', () => {
      mount.render(gate());
      act(() => {
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
      });
      expect(onDone).toHaveBeenCalledExactlyOnceWith('skipped');
    });

    it('finishes by itself when the clip fails to load', () => {
      mount.render(gate());
      fire(mount.container.querySelectorAll('source')[1] ?? null, 'error');
      expect(onDone).toHaveBeenCalledExactlyOnceWith('error');
    });

    it('finishes by itself when the clip never becomes playable', () => {
      mount.render(gate());
      act(() => vi.advanceTimersByTime(1500));
      expect(onDone).toHaveBeenCalledExactlyOnceWith('error');
    });

    it('stops listening for Escape once it is gone', () => {
      mount.render(gate());
      mount.render(<div />);
      act(() => {
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
      });
      expect(onDone).not.toHaveBeenCalled();
    });

    it('owns no live region', () => {
      mount.render(gate());
      expect(mount.container.querySelectorAll('[aria-live], [role="status"], [role="alert"]')).toHaveLength(0);
    });
  });

  describe('reduced motion', () => {
    beforeEach(() => stubReducedMotion(true));

    it('mounts no video, announces the descent and finishes at once', () => {
      mount.render(gate());
      expect(mount.container.querySelector('video')).toBeNull();
      expect(mount.container.innerHTML).toBe('');
      expect(announce).toHaveBeenCalledExactlyOnceWith('Descending into the crypt.');
      expect(onDone).toHaveBeenCalledExactlyOnceWith('reduced-motion');
    });

    it.each(['fade', 'final-door', 'escape'] as const)('skips %s without an announcement', (variant) => {
      mount.render(gate(variant));
      expect(mount.container.innerHTML).toBe('');
      expect(announce).not.toHaveBeenCalled();
      expect(onDone).toHaveBeenCalledExactlyOnceWith('reduced-motion');
    });
    });

    it.each(['final-door', 'escape'] as const)('plays %s once and falls through when its media is missing', (variant) => {
      mount.render(gate(variant));
      expect(Array.from(video()?.querySelectorAll('source') ?? []).map((s) => s.getAttribute('src'))).toEqual([
        `/art/motion/${variant}.webm`,
        `/art/motion/${variant}.mp4`,
      ]);
      fire(video(), 'error');
      act(() => vi.advanceTimersByTime(1500));
      expect(onDone).toHaveBeenCalledExactlyOnceWith('error');
    });

  describe('fade', () => {
    it('is a hidden sheet that never takes a click, and ends within half a second', () => {
      mount.render(gate('fade'));
      const sheet = mount.container.querySelector('[data-testid="descent-fade"]');
      expect(sheet?.getAttribute('aria-hidden')).toBe('true');
      expect(sheet?.querySelector('button, a, input')).toBeNull();
      expect(announce).not.toHaveBeenCalled();
      act(() => vi.advanceTimersByTime(499));
      expect(onDone).not.toHaveBeenCalled();
      act(() => vi.advanceTimersByTime(1));
      expect(onDone).toHaveBeenCalledExactlyOnceWith('ended');
    });
  });
});
