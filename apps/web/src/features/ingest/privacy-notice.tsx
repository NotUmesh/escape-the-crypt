import { INGEST_UI_COPY, PRIVACY_NOTICE } from '@escape-the-crypt/core';
import { useId } from 'react';
import './ingest-controls.css';
import './privacy-notice.css';

/** States where the file stays and what is sent later (10.1, 10.2, 10.3). */
export function PrivacyNotice(): React.JSX.Element {
  const titleId = useId();
  return (
    <section className="ingest-block ingest-panel ingest-privacy" aria-labelledby={titleId}>
      <h2 className="ingest-title" id={titleId}>
        {INGEST_UI_COPY.privacyTitle}
      </h2>
      <p>{PRIVACY_NOTICE.stays}</p>
      <p>{PRIVACY_NOTICE.sent}</p>
    </section>
  );
}