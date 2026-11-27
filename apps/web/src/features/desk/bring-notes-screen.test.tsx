import { act } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { ENTER_CRYPT_LABEL, GENERATION_COPY, SAMPLE_CRYPT_LINE } from '@escape-the-crypt/core';
import type { GenerationState } from '../generate/generation-flow';
import { useMount } from '../../test-support/flow-dom';
import { BringNotesScreen } from './bring-notes-screen';
import { SettingsSlot } from './settings-slot';
import { StartActions } from './start-actions';

const VIEWPORT = { width: 1280, height: 720 };
const INGEST = <div className="ingest-root ingest-flow" data-testid="ingest-stub"><textarea aria-label="stub" /></div>;

function screen(extra: Partial<React.ComponentProps<typeof BringNotesScreen>> = {}): React.JSX.Element {
  return <BringNotesScreen ingest={INGEST} confirmed={false} backHref="/" viewport={VIEWPORT} {...extra} />;
}
const order = (root: ParentNode, ...ids: string[]): number[] => {
  const all = Array.from(root.querySelectorAll('*'));
  return ids.map((id) => all.indexOf(root.querySelector(`[data-testid="${id}"]`) as Element));
};

describe('BringNotesScreen', () => {
  const mount = useMount();

  it('puts the ingest flow on the open book unchanged, under one h1', () => {
    mount.render(screen());
    expect(mount.container.querySelectorAll('h1')).toHaveLength(1);
    expect(mount.container.querySelector('h1')?.textContent).toBe('Bring your notes');
    expect(mount.container.querySelector('[data-testid="book-pages"] [data-testid="ingest-stub"]')).not.toBeNull();
    expect(mount.container.querySelector('[data-testid="desk-scene"]')?.getAttribute('data-variant')).toBe('book');
  });

  it('links back to the desk', () => {
    mount.render(screen({ backHref: '/' }));
    const link = Array.from(mount.container.querySelectorAll('a')).find((a) => a.textContent === 'Back to the desk');
    expect(link?.getAttribute('href')).toBe('/');
  });

  it('shows neither the settings slot nor the actions before the notes are confirmed', () => {
    mount.render(screen({ actions: <button type="button">go</button> }));
    expect(mount.container.querySelector('[data-testid="settings-slot"]')).toBeNull();
    expect(mount.container.querySelector('[data-testid="bring-actions"]')).toBeNull();
  });

  it('after Confirm puts the settings slot between the book and the actions', () => {
    mount.render(
      screen({
        confirmed: true,
        settingsSlot: <fieldset data-testid="stub-settings"><legend>Length</legend></fieldset>,
        actions: <button type="button" data-testid="stub-go">go</button>,
      }),
    );
    const [pages, slot, stub, actions] = order(mount.container, 'book-pages', 'settings-slot', 'stub-settings', 'stub-go');
    expect(pages).toBeLessThan(slot as number);
    expect(slot).toBeLessThan(actions as number);
    expect(stub).toBeGreaterThan(slot as number);
    expect(stub).toBeLessThan(actions as number);
  });

  it('renders nothing visible for the default, empty settings slot', () => {
    mount.render(screen({ confirmed: true, actions: <button type="button">go</button> }));
    expect(mount.container.querySelector('[data-testid="settings-slot"]')?.childNodes).toHaveLength(0);
  });

  it('hides the whole screen while the dig covers it, and keeps the book mounted', () => {
    mount.render(screen({ hidden: true }));
    const root = mount.container.querySelector('[data-testid="bring-notes-screen"]') as HTMLElement;
    expect(root.hidden).toBe(true);
    expect(root.querySelector('[data-testid="ingest-stub"]')).not.toBeNull();
  });

  it('owns no live region of its own', () => {
    mount.render(screen({ confirmed: true }));
    expect(mount.container.querySelectorAll('[aria-live], [role="status"]')).toHaveLength(0);
  });
});

describe('SettingsSlot', () => {
  const mount = useMount();
  it('renders nothing until the length and difficulty choice replaces it', () => {
    mount.render(<SettingsSlot />);
    expect(mount.container.innerHTML).toBe('');
  });
});

const noop = (): void => undefined;
function generation(state: GenerationState, extra: { onGenerate?: () => void; onCancel?: () => void; onPlaySample?: () => void } = {}) {
  return { state, onGenerate: noop, onCancel: noop, onPlaySample: noop, ...extra };
}
const names = (root: ParentNode): string[] => Array.from(root.querySelectorAll('button')).map((b) => b.textContent ?? '');

describe('StartActions', () => {
  const mount = useMount();

  it('offers only the sample start, with its line, when no worker is configured', () => {
    const enter = vi.fn();
    mount.render(<StartActions onEnter={enter} />);
    expect(names(mount.container)).toEqual([ENTER_CRYPT_LABEL]);
    expect(mount.container.textContent).toContain(SAMPLE_CRYPT_LINE);
    act(() => (mount.container.querySelector('button') as HTMLButtonElement).click());
    expect(enter).toHaveBeenCalledTimes(1);
  });

  it('offers Generate and the sample start when a worker is configured and idle', () => {
    const onGenerate = vi.fn();
    mount.render(<StartActions onEnter={noop} generation={generation({ status: 'idle' }, { onGenerate })} />);
    expect(names(mount.container)).toEqual([GENERATION_COPY.generateButton, ENTER_CRYPT_LABEL]);
    act(() => (mount.container.querySelector('button') as HTMLButtonElement).click());
    expect(onGenerate).toHaveBeenCalledTimes(1);
  });

  it('renders nothing while a job runs, because the dig is shown instead', () => {
    mount.render(<StartActions onEnter={noop} generation={generation({ status: 'polling', key: 'k', jobId: 'j' })} />);
    expect(mount.container.innerHTML).toBe('');
  });

  it('shows the stopped message with both buttons back after a cancel', () => {
    mount.render(<StartActions onEnter={noop} generation={generation({ status: 'cancelled' })} />);
    expect(mount.container.querySelector('[data-testid="generation-cancelled"]')?.textContent).toBe(GENERATION_COPY.cancelled);
    expect(names(mount.container)).toEqual([GENERATION_COPY.generateButton, ENTER_CRYPT_LABEL]);
  });

  it('shows the failure, a way to try again and the sample offer, but not the sample start', () => {
    const onPlaySample = vi.fn();
    mount.render(<StartActions onEnter={noop} generation={generation({ status: 'failed', kind: 'generation-failed' }, { onPlaySample })} />);
    const copy = GENERATION_COPY.failures['generation-failed'];
    expect(mount.container.querySelector('[data-testid="generation-failed"]')?.textContent).toContain(copy.what);
    expect(names(mount.container)).toEqual([GENERATION_COPY.generateButton, GENERATION_COPY.sampleOffer]);
    act(() => (mount.container.querySelectorAll('button')[1] as HTMLButtonElement).click());
    expect(onPlaySample).toHaveBeenCalledTimes(1);
  });
});
