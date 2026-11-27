import { useCallback, useId, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { browserShareEnv } from './browser-share-env';
import { canUseWebShare, performShare, statusFor } from './share-actions';
import type { ShareEnv } from './share-actions';
import { SHARE_COPY } from './share-card-copy';
import type { ShareCardData } from './share-card-data';
import { cardLines, shareText } from './share-card-lines';
import './share-card.css';

export interface ShareCardProps {
  /** From `buildShareCardData`. Null before the run has escaped: nothing is drawn. */
  readonly data: ShareCardData | null;
  /** Sends the result sentence to the one live region on screen. This component has none. */
  readonly announce?: (message: string) => void;
  /** Test seam. Defaults to the real browser. */
  readonly createEnv?: (lines: ReturnType<typeof cardLines>) => ShareEnv;
}

/**
 * The share card after an escape: a card with the headline and the five outcome counts, and one
 * button. The card is real text, not a picture, so a screen reader reads it as it is. It holds no
 * question, answer, concept title or note text. With the Web Share API the button shares the card;
 * without it, it downloads a PNG and copies the text.
 */
export function ShareCard({ data, announce, createEnv = browserShareEnv }: ShareCardProps): ReactNode {
  const headingId = useId();
  const [working, setWorking] = useState(false);
  const [status, setStatus] = useState('');
  const lines = useMemo(() => (data === null ? [] : cardLines(data)), [data]);
  const text = useMemo(() => (data === null ? '' : shareText(data)), [data]);

  const onShare = useCallback((): void => {
    // aria-disabled, not disabled: a button that is disabled while it has focus drops the focus.
    if (working) return;
    setWorking(true);
    setStatus('');
    void (async () => {
      const env = createEnv(lines);
      const outcome = await performShare(env, text);
      const sentence = statusFor(outcome);
      setWorking(false);
      setStatus(sentence);
      if (sentence !== '') announce?.(sentence);
    })();
  }, [working, createEnv, lines, text, announce]);

  if (data === null) return null;
  const webShare = canUseWebShare(typeof navigator === 'undefined' ? {} : navigator);
  const counts = lines.filter((line) => line.role === 'count');
  return (
    <section className="share-section" aria-labelledby={headingId} data-testid="share-section">
      <h3 id={headingId}>{SHARE_COPY.heading}</h3>
      <div className="share-card" data-testid="share-card">
        <p className="share-card__app">{SHARE_COPY.appName}</p>
        <p className="share-card__headline" data-testid="share-headline">
          {lines.find((line) => line.role === 'headline')?.text}
        </p>
        {data.sample ? <p className="share-card__note">{lines.find((line) => line.role === 'note')?.text}</p> : null}
        <ul className="share-card__counts" aria-label={SHARE_COPY.countsHeading}>
          {counts.map((line) => (
            <li key={line.text}>
              <span>{line.text}</span>
              <span className="share-card__value">{line.value}</span>
            </li>
          ))}
        </ul>
        <p className="share-card__footer">{SHARE_COPY.footer}</p>
      </div>
      <p className="share-section__privacy">{SHARE_COPY.privacy}</p>
      <button type="button" className="share-button" onClick={onShare} aria-disabled={working} aria-busy={working}>
        {webShare ? SHARE_COPY.shareButton : SHARE_COPY.saveButton}
      </button>
      <p className="share-section__status" data-testid="share-status">
        {status}
      </p>
    </section>
  );
}
