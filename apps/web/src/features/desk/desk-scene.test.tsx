import { afterEach, describe, expect, it, vi } from 'vitest';
import { LanternProvider } from '../crypt/lantern-context';
import { useMount } from '../../test-support/flow-dom';
import { DeskScene } from './desk-scene';

function stubMatchMedia(reduced: boolean): void {
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: query.includes('prefers-reduced-motion') ? reduced : false,
    media: query,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  }));
}

const scene = (variant: 'hub' | 'book', viewport = { width: 1280, height: 720 }): React.JSX.Element => (
  <LanternProvider>
    <DeskScene variant={variant} viewport={viewport}>
      <p>content</p>
    </DeskScene>
  </LanternProvider>
);

describe('DeskScene', () => {
  const mount = useMount();
  afterEach(() => {
    vi.unstubAllGlobals();
    window.localStorage.clear();
  });

  it('uses the desktop set with a 2x background and the foreground in a landscape window', () => {
    stubMatchMedia(false);
    mount.render(scene('hub'));
    const root = mount.container.querySelector('[data-testid="desk-scene"]');
    expect(root?.getAttribute('data-set')).toBe('desktop');
    const sources = Array.from(root?.querySelectorAll('img') ?? []).map((i) => i.getAttribute('src'));
    expect(sources).toEqual([
      '/art/desk/desktop/background.webp',
      '/art/desk/desktop/candle.webp',
      '/art/desk/desktop/foreground.webp',
    ]);
    expect(root?.querySelector('.desk-scene__background')?.getAttribute('srcset')).toContain('background@2x.webp 2x');
  });

  it('uses the mobile art on a phone-shaped window', () => {
    stubMatchMedia(false);
    mount.render(scene('hub', { width: 390, height: 844 }));
    const root = mount.container.querySelector('[data-testid="desk-scene"]');
    expect(root?.getAttribute('data-set')).toBe('mobile');
    const sources = Array.from(root?.querySelectorAll('img') ?? []).map((i) => i.getAttribute('src'));
    expect(sources).toEqual(['/art/desk/mobile/background.webp', '/art/desk/mobile/candle.webp']);
  });

  it('draws the candle flame in code and the vignette when lantern mode is off', () => {
    stubMatchMedia(false);
    mount.render(scene('hub'));
    expect(mount.container.querySelector('[data-flame="ambient"]')).not.toBeNull();
    expect(mount.container.querySelector('.desk-scene__vignette')).not.toBeNull();
  });

  it('removes the vignette and the push-in in lantern mode', () => {
    stubMatchMedia(false);
    window.localStorage.setItem('escape-the-crypt:lantern', 'on');
    mount.render(scene('book'));
    const root = mount.container.querySelector('[data-testid="desk-scene"]');
    expect(root?.getAttribute('data-lantern')).toBe('true');
    expect(root?.getAttribute('data-push')).toBe('false');
    expect(mount.container.querySelector('.desk-scene__vignette')).toBeNull();
  });

  it('pushes in on the book screen only, and not under reduced motion', () => {
    stubMatchMedia(false);
    window.localStorage.setItem('escape-the-crypt:lantern', 'off');
    mount.render(scene('book'));
    expect(mount.container.querySelector('[data-testid="desk-scene"]')?.getAttribute('data-push')).toBe('true');
    mount.render(scene('hub'));
    expect(mount.container.querySelector('[data-testid="desk-scene"]')?.getAttribute('data-push')).toBe('false');
    stubMatchMedia(true);
    mount.render(<div />);
    mount.render(scene('book'));
    expect(mount.container.querySelector('[data-testid="desk-scene"]')?.getAttribute('data-push')).toBe('false');
  });

  it('keeps content above the art and the art out of the accessibility tree', () => {
    stubMatchMedia(false);
    mount.render(scene('hub'));
    expect(mount.container.querySelector('.desk-scene__stage')?.getAttribute('aria-hidden')).toBe('true');
    expect(mount.container.querySelector('.desk-scene__content')?.textContent).toBe('content');
  });
});
