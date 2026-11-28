import { useState } from 'react';
import type { ReactNode } from 'react';
import { AUTOPSY_LABELS, ROOM_PLAY_LABELS, SAMPLE_CRYPT_LABEL, selectAutopsy } from '@escape-the-crypt/core';
import type { ConceptOutcome, State } from '@escape-the-crypt/core';
import type { RoomAction } from '../../state/room-actions';
import type { RoomAssets } from '../../state/room-assets';
import { withConceptTitles } from './autopsy-titles';
import type { AutopsyEntryView } from './autopsy-titles';
import { FinalDoorSection } from './final-door-section';
import { QuillMark } from './quill-mark';
import { resolveExcerpt } from './evidence-text';
import { ShareCard } from '../share/share-card';
import { buildShareCardData } from '../share/share-card-data';
import type { ResolvedExcerpt } from './evidence-text';

export interface AutopsyViewProps {
  readonly state: State;
  readonly assets: RoomAssets | null;
  readonly dispatch: (action: RoomAction) => void;
  /** Sends the share result to the one live region on screen. */
  readonly announce?: (message: string) => void;
  /** The public title of the sample that was played. Used only when the crypt is a sample. */
  readonly sampleTitle?: string;
}

const OUTCOME_ORDER: readonly ConceptOutcome[] = [
  'first-try-correct',
  'assisted',
  'retried',
  'challenged',
  'review-due',
];

/* Icons: decorative only. The text label beside each one carries the meaning. */
function IconFrame({ children }: { readonly children: ReactNode }): ReactNode {
  return (
    <svg
      className="autopsy-icon"
      width="20"
      height="20"
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {children}
    </svg>
  );
}

const OUTCOME_ICONS: Readonly<Record<ConceptOutcome, () => ReactNode>> = {
  'first-try-correct': () => (
    <IconFrame>
      <path d="M4 10.5l4 4 8-9" />
    </IconFrame>
  ),
  assisted: () => (
    <IconFrame>
      <path d="M10 3a5 5 0 0 0-3 9v2h6v-2a5 5 0 0 0-3-9z" />
      <path d="M8 17h4" />
    </IconFrame>
  ),
  retried: () => (
    <IconFrame>
      <path d="M16 10a6 6 0 1 1-2-4.5" />
      <path d="M16 3v4h-4" />
    </IconFrame>
  ),
  challenged: () => (
    <IconFrame>
      <path d="M5 3v14" />
      <path d="M5 4h10l-2 3 2 3H5" />
    </IconFrame>
  ),
  'review-due': () => (
    <IconFrame>
      <circle cx="10" cy="10" r="7" />
      <path d="M10 6v4l3 2" />
    </IconFrame>
  ),
};

function OutcomeMark({ outcome }: { readonly outcome: ConceptOutcome }): ReactNode {
  return (
    <span className="autopsy-outcome">
      {OUTCOME_ICONS[outcome]()}
      <span className="autopsy-outcome__label">{AUTOPSY_LABELS[outcome]}</span>
    </span>
  );
}

/** Reads the concept's first question and its first excerpt from the prebuilt maps only. */
function excerptFor(assets: RoomAssets, conceptId: string): ResolvedExcerpt | null {
  const map = assets.firstQuestionByConcept;
  const questionId = Object.hasOwn(map, conceptId) ? map[conceptId] : undefined;
  if (questionId === undefined || !Object.hasOwn(assets.content.questions, questionId)) return null;
  const excerpt = assets.content.questions[questionId]?.excerpts[0];
  return excerpt === undefined ? null : resolveExcerpt(assets, excerpt, assets.source);
}

function ConceptEntry({
  entry,
  assets,
}: {
  readonly entry: AutopsyEntryView;
  readonly assets: RoomAssets | null;
}): ReactNode {
  const [open, setOpen] = useState(false);
  const [resolved, setResolved] = useState<ResolvedExcerpt | null>(null);
  const toggle = (): void => {
    if (!open && assets !== null) setResolved(excerptFor(assets, entry.conceptId));
    setOpen(!open);
  };
  const panelId = `autopsy-excerpt-${entry.conceptId}`;
  return (
    <li className="autopsy-entry" data-outcome={entry.outcome}>
      <h4 className="autopsy-entry__title">{entry.title}</h4>
      <OutcomeMark outcome={entry.outcome} />
      {entry.outcome === 'challenged' ? (
        <p className="autopsy-entry__statement">{ROOM_PLAY_LABELS.autopsyChallengedStatement}</p>
      ) : null}
      <button type="button" aria-expanded={open} aria-controls={panelId} onClick={toggle}>
        {open ? ROOM_PLAY_LABELS.hideExcerpt : ROOM_PLAY_LABELS.showExcerpt}
      </button>
      {open ? (
        <div id={panelId} className="autopsy-entry__excerpt">
          {resolved === null ? (
            <p>{ROOM_PLAY_LABELS.excerptUnavailable}</p>
          ) : (
            <figure>
              <blockquote>{resolved.quote}</blockquote>
              <figcaption>
                {resolved.citationLabel}
                {resolved.matched ? ` · ${ROOM_PLAY_LABELS.excerptMatched}` : ''}
              </figcaption>
            </figure>
          )}
        </div>
      ) : null}
    </li>
  );
}

function CountsSection({ counts }: { readonly counts: Readonly<Record<ConceptOutcome, number>> }): ReactNode {
  return (
    <section className="autopsy-counts" aria-labelledby="autopsy-counts-heading">
      <h3 id="autopsy-counts-heading">{ROOM_PLAY_LABELS.autopsyCountsHeading}</h3>
      <ul>
        {OUTCOME_ORDER.map((outcome) => (
          <li key={outcome} data-outcome={outcome}>
            <OutcomeMark outcome={outcome} />
            <span className="autopsy-count" data-testid={`autopsy-count-${outcome}`}>
              {counts[outcome]}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

function ConceptsSection({
  entries,
  assets,
}: {
  readonly entries: readonly AutopsyEntryView[];
  readonly assets: RoomAssets | null;
}): ReactNode {
  return (
    <section className="autopsy-concepts" aria-labelledby="autopsy-concepts-heading">
      <h3 id="autopsy-concepts-heading">{ROOM_PLAY_LABELS.autopsyConceptsHeading}</h3>
      <ul>
        {entries.map((entry) => (
          <ConceptEntry key={entry.conceptId} entry={entry} assets={assets} />
        ))}
      </ul>
    </section>
  );
}

/** The Autopsy: one entry per concept, the five outcome counts and a way to play again. The final door section follows the concepts. */
export function AutopsyView({ state, assets, dispatch, announce, sampleTitle = SAMPLE_CRYPT_LABEL }: AutopsyViewProps): ReactNode {
  const view = selectAutopsy(state);
  if (!view.available || view.counts === null) return null;
  const entries = assets === null ? view.entries.map((e) => ({ ...e, title: e.conceptId })) : withConceptTitles(view.entries, assets.content);
  return (
    <section className="autopsy-view" data-testid="autopsy-view" aria-labelledby="autopsy-heading">
      <header className="autopsy-view__head">
        <h2 id="autopsy-heading">{ROOM_PLAY_LABELS.autopsyHeading}</h2>
        <QuillMark />
      </header>
      <CountsSection counts={view.counts} />
      <ShareCard
        data={buildShareCardData(view, assets === null || assets.source === 'notes' ? { kind: 'notes' } : { kind: 'sample', title: sampleTitle })}
        announce={announce}
      />
      <ConceptsSection entries={entries} assets={assets} />
      <FinalDoorSection state={state} content={assets === null ? null : assets.content} />
      <button type="button" onClick={() => dispatch({ type: 'playAgain' })}>
        {ROOM_PLAY_LABELS.playAgain}
      </button>
    </section>
  );
}
