import { act } from 'react';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { JUDGE_ACCESS_COPY } from '@escape-the-crypt/core';
import { useMount } from '../../test-support/flow-dom';
import { JudgeAccess } from './judge-access';

function Harness({ denied = false, onChange }: { readonly denied?: boolean; readonly onChange?: (code: string) => void }): React.JSX.Element {
  const [code, setCode] = useState('');
  return (
    <JudgeAccess
      code={code}
      denied={denied}
      onChange={(next) => {
        setCode(next);
        onChange?.(next);
      }}
    />
  );
}

function type(input: HTMLInputElement, text: string): void {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
  act(() => {
    setter?.call(input, text);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

describe('JudgeAccess', () => {
  const mount = useMount();
  const details = (): HTMLDetailsElement => mount.container.querySelector('details') as HTMLDetailsElement;
  const field = (): HTMLInputElement => mount.container.querySelector('input') as HTMLInputElement;

  it('is a closed disclosure named "Judge access"', () => {
    mount.render(<Harness />);
    expect(details().open).toBe(false);
    expect(details().querySelector('summary')?.textContent).toBe(JUDGE_ACCESS_COPY.summary);
  });

  it('has a labelled password field that browsers are told not to remember', () => {
    mount.render(<Harness />);
    const input = field();
    expect(input.type).toBe('password');
    expect(input.autocomplete).toBe('off');
    expect(input.getAttribute('spellcheck')).toBe('false');
    expect(mount.container.querySelector(`label[for="${input.id}"]`)?.textContent).toBe(JUDGE_ACCESS_COPY.label);
    expect(input.getAttribute('aria-describedby')).toBe(mount.container.querySelector('.fh-note')?.id);
    expect(input.hasAttribute('name')).toBe(false);
  });

  it('hands each edit to the host and shows what the host gives back', () => {
    const heard = vi.fn();
    mount.render(<Harness onChange={heard} />);
    type(field(), 'abc');
    expect(heard).toHaveBeenLastCalledWith('abc');
    expect(field().value).toBe('abc');
  });

  it('opens and marks the field invalid when the code was refused', () => {
    mount.render(<Harness denied />);
    expect(details().open).toBe(true);
    expect(field().getAttribute('aria-invalid')).toBe('true');
  });

  it('does not mark the field invalid before a refusal', () => {
    mount.render(<Harness />);
    expect(field().hasAttribute('aria-invalid')).toBe(false);
  });

  it('writes the code to no storage and no address', () => {
    localStorage.clear();
    sessionStorage.clear();
    const before = location.href;
    mount.render(<Harness />);
    type(field(), 'secret-code-0123456789-abcdef');
    expect(JSON.stringify({ ...localStorage })).not.toContain('secret-code');
    expect(JSON.stringify({ ...sessionStorage })).not.toContain('secret-code');
    expect(location.href).toBe(before);
    expect(document.cookie).not.toContain('secret-code');
  });
});
