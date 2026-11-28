import { useContext } from 'react';
import type { ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { ROOM_PLAY_LABELS } from '@escape-the-crypt/core';
import { LockActionHost } from './lock-overlay-context';

type Props = { readonly onClick: () => void } | { readonly form: string };

export function LockSubmit(props: Props): ReactNode {
  const host = useContext(LockActionHost);
  const button = (
    <button
      className="costume-seal lock-submit"
      {...('form' in props ? { type: 'submit', form: props.form } : { type: 'button', onClick: props.onClick })}
    >
      {ROOM_PLAY_LABELS.submitAnswer}
    </button>
  );
  return host === null ? button : createPortal(button, host);
}
