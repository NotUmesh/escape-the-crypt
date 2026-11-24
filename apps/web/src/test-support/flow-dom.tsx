import { act } from 'react';
import { createRoot } from 'react-dom/client';
import type { Root } from 'react-dom/client';
import { afterEach, beforeEach } from 'vitest';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

export interface Mount {
  readonly container: HTMLDivElement;
  render(node: React.ReactNode): void;
}

/** Mounts a fresh container and React root before each test and removes them after. */
export function useMount(): Mount {
  let container: HTMLDivElement;
  let root: Root;
  beforeEach(() => {
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
  });
  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });
  return {
    get container() {
      return container;
    },
    render: (node) => act(() => root.render(node)),
  };
}

export function buttonByText(container: ParentNode, text: string): HTMLButtonElement {
  const found = Array.from(container.querySelectorAll('button')).find((b) => b.textContent === text);
  if (!found) throw new Error(`no button "${text}"`);
  return found;
}

/** Clicks a button by its visible text. */
export async function clickButton(container: ParentNode, text: string): Promise<void> {
  const button = buttonByText(container, text);
  await act(async () => button.click());
}

/** Chooses a file in the PDF input. */
export function chooseFile(container: ParentNode, file: File): void {
  const input = container.querySelector<HTMLInputElement>('input[type="file"]');
  if (input === null) throw new Error('no file input');
  Object.defineProperty(input, 'files', { value: [file], configurable: true });
  act(() => {
    input.dispatchEvent(new Event('change', { bubbles: true }));
  });
}

/** Sets the value of a textarea the way a user typing would. */
export function setTextarea(area: HTMLTextAreaElement, text: string): void {
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set;
  act(() => {
    setter?.call(area, text);
    area.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

export function typeNotes(container: ParentNode, text: string): void {
  const area = container.querySelector<HTMLTextAreaElement>('.ingest-paste textarea');
  if (area === null) throw new Error('no paste textarea');
  setTextarea(area, text);
}

export function announcement(container: ParentNode): string {
  return container.querySelector('[role="status"]')?.textContent ?? '';
}