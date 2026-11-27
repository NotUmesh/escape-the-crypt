import { useCallback, useState } from 'react';
import type { ReactNode } from 'react';
import './shell-announcer.css';

export interface ShellAnnouncerProps {
  /** The latest message. An empty string says nothing. */
  readonly message: string;
}

/**
 * The one polite live region of the pre-crypt screens. Every other part of these screens
 * (generation progress, export status, resume messages, the descent) sends its text here.
 * It stays mounted so a screen reader has the region before the first message arrives.
 */
export function ShellAnnouncer({ message }: ShellAnnouncerProps): ReactNode {
  return (
    <div className="shell-announcer" role="status" aria-live="polite" aria-atomic="true" data-testid="shell-announcer">
      {message}
    </div>
  );
}

/** Holds the announcer's message. `announce('')` clears it. */
export function useShellAnnouncer(): { readonly message: string; readonly announce: (message: string) => void } {
  const [message, setMessage] = useState('');
  const announce = useCallback((next: string): void => setMessage(next), []);
  return { message, announce };
}
