import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { useMount } from '../../test-support/flow-dom';
import { CandleIcon, ParchmentTag } from './ornaments';

const costume = readFileSync(join(process.cwd(), 'src', 'styles', 'costume.css'), 'utf8');

describe('costume gallery', () => {
  const mount = useMount();
  const style = document.createElement('style');
  afterEach(() => style.remove());

  it('renders token-based pieces with focus appropriate to both paper and stone', () => {
    mount.render(
      <>
        <section className="costume-paper">
          <button type="button" className="costume-seal">Continue</button>
          <ParchmentTag>Sample</ParchmentTag>
        </section>
        <header className="costume-stone">
          <button type="button">Back</button>
          <CandleIcon lit />
          <CandleIcon lit={false} />
        </header>
      </>,
    );
    style.textContent = costume;
    document.head.append(style);
    function declarations(element: Element, property: string): string[] {
      return Array.from(style.sheet?.cssRules ?? []).flatMap((rule) =>
        rule instanceof CSSStyleRule && element.matches(rule.selectorText)
          ? [rule.style.getPropertyValue(property)]
          : [],
      ).filter(Boolean);
    }

    const [paper, stone] = Array.from(mount.container.children);
    const [seal, plaque] = Array.from(mount.container.querySelectorAll('button'));
    const tag = mount.container.querySelector('.costume-tag');
    const candles = mount.container.querySelectorAll('.costume-candle');
    if (!paper || !stone || !seal || !plaque || !tag) throw new Error('Missing gallery piece');
    expect(declarations(paper, 'background-color')).toContain('var(--parchment-100)');
    expect(declarations(stone, 'background-image').at(-1)).toContain('var(--stone-800)');
    expect(declarations(seal, 'background-image').at(-1)).toContain('var(--ember-600)');
    expect(declarations(plaque, 'background-image').at(-1)).toContain('var(--brass-700)');
    expect(declarations(tag, 'background-color')).toContain('var(--parchment-100)');
    expect(tag.querySelector('svg')?.getAttribute('aria-hidden')).toBe('true');
    expect(candles).toHaveLength(2);
    const flame = candles[0]?.querySelector('[data-lit]');
    if (!flame) throw new Error('Missing lit candle flame');
    expect(declarations(flame, 'fill')).toContain('var(--candle-400)');
    expect(candles[1]?.querySelector('[data-lit]')).toBeNull();
    expect(declarations(paper, '--costume-focus')).toContain('var(--focus-ring-on-light)');
    expect(declarations(stone, '--costume-focus')).toContain('var(--focus-ring)');
    for (const button of [seal, plaque]) {
      button.focus();
      expect(document.activeElement).toBe(button);
      expect(declarations(button, 'outline')).toContain('var(--costume-focus, var(--focus-ring))');
      expect(declarations(button, 'outline-offset')).toContain('var(--focus-offset)');
    }
  });
});
