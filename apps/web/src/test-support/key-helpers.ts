import { act } from 'react';

/** Sends one key to an element. Stands in for a key press on the focused element. */
export function press(target: Element, key: string, init: KeyboardEventInit = {}): void {
  act(() => {
    target.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init }));
  });
}
/** Enter or Space on a focused button activates it. */
export function activate(button: HTMLElement): void {
  act(() => {
    button.focus();
    button.click();
  });
}
export function byLabel(container: ParentNode, label: string | RegExp): HTMLElement {
  const all = Array.from(container.querySelectorAll<HTMLElement>('[aria-label]'));
  const found = all.find((el) => {
    const l = el.getAttribute('aria-label') ?? '';
    return typeof label === 'string' ? l === label : label.test(l);
  });
  if (found === undefined) throw new Error(`No element labelled ${String(label)}`);
  return found;
}
