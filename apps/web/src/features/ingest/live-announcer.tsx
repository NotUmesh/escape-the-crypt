import './live-announcer.css';

export interface LiveAnnouncerProps {
  /** The latest message from the state machine. */
  readonly message: string;
}

/** A visually hidden polite live region (9.3). */
export function LiveAnnouncer({ message }: LiveAnnouncerProps): React.JSX.Element {
  return (
    <div className="ingest-announcer" role="status" aria-live="polite" aria-atomic="true">
      {message}
    </div>
  );
}