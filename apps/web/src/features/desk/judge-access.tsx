import { useEffect, useId, useRef } from 'react';
import type { ChangeEvent, ReactNode } from 'react';
import { JUDGE_ACCESS_COPY } from '@escape-the-crypt/core';
import './judge-access.css';

export interface JudgeAccessProps {
  /** The code as typed. The host holds it in memory; this component keeps no copy. */
  readonly code: string;
  readonly onChange: (code: string) => void;
  /** True after the worker refused the code: the disclosure opens and the field is marked invalid. */
  readonly denied: boolean;
}

/**
 * A closed disclosure with one field, for judges who were given an access code. It renders no
 * storage, no URL and no log: the code goes up to the host's state and out only in the
 * `X-Judge-Token` header of the generate request. The refusal message itself is the ordinary
 * generation failure notice, so this only opens the disclosure and marks the field.
 */
export function JudgeAccess({ code, onChange, denied }: JudgeAccessProps): ReactNode {
  const copy = JUDGE_ACCESS_COPY;
  const id = useId();
  const details = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    if (denied && details.current !== null) details.current.open = true;
  }, [denied]);
  const onInput = (event: ChangeEvent<HTMLInputElement>): void => onChange(event.target.value);
  return (
    <details className="judge-access" ref={details} data-testid="judge-access">
      <summary className="judge-access__summary">{copy.summary}</summary>
      <div className="judge-access__body">
        <label htmlFor={`${id}-code`}>{copy.label}</label>
        <input
          id={`${id}-code`}
          className="judge-access__input"
          type="password"
          value={code}
          onChange={onInput}
          autoComplete="off"
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
          aria-describedby={`${id}-hint`}
          aria-invalid={denied ? true : undefined}
        />
        <p className="fh-note" id={`${id}-hint`}>
          {copy.hint}
        </p>
      </div>
    </details>
  );
}
