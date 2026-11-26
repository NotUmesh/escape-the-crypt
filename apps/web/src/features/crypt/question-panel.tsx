import { createElement, useEffect, useRef } from 'react';
import type { KeyboardEvent, ReactNode, RefObject } from 'react';
import { ROOM_PLAY_LABELS } from '@escape-the-crypt/core';
import type { LockType } from '@escape-the-crypt/core';
import { LOCK_PANELS } from './lock-panel-registry';
import type { LockPanelRegistry } from './lock-panel-registry';
import './question-panel.css';

export interface QuestionPanelProps {
  readonly slotId: string;
  readonly questionId: string;
  readonly questionType: LockType;
  readonly heading: string;
  /** While false the panel is hidden but stays mounted, so an Escape keeps the draft. */
  readonly open: boolean;
  /** The control that opened the panel; it gets focus back on close. */
  readonly openerRef: RefObject<HTMLElement | null>;
  /** Called on Escape. The shell never dispatches an Event. */
  readonly onClose: () => void;
  /** True while a judged answer waits for Continue; Escape then does nothing. */
  readonly awaitingContinue?: boolean;
  /** Placement for the layered art (task 14.11); the plain loop ignores it. */
  readonly side?: 'left' | 'right';
  readonly panels?: LockPanelRegistry;
  /** Evidence panel and hint, skip and challenge controls arrive here in tasks 6 and 7. */
  readonly children?: ReactNode;
}

/** The one question panel shared by the room screen and the final door. */
export function QuestionPanel(props: QuestionPanelProps): ReactNode {
  // Keyed so the draft resets whenever the slot's current question changes.
  return <PanelShell key={`${props.slotId}:${props.questionId}`} {...props} />;
}

function PanelShell({
  slotId,
  questionId,
  questionType,
  heading,
  open,
  openerRef,
  onClose,
  awaitingContinue = false,
  side = 'right',
  panels = LOCK_PANELS,
  children,
}: QuestionPanelProps): ReactNode {
  const headingRef = useRef<HTMLHeadingElement>(null);
  const wasOpen = useRef(false);

  useEffect(() => {
    if (open && !wasOpen.current) headingRef.current?.focus();
    if (!open && wasOpen.current) openerRef.current?.focus();
    wasOpen.current = open;
  }, [open, openerRef]);

  function onKeyDown(event: KeyboardEvent<HTMLElement>): void {
    if (event.key !== 'Escape' || awaitingContinue) return;
    event.preventDefault();
    onClose();
  }

  const LockPanel = panels[questionType];

  return (
    <section
      className="question-panel"
      data-side={side}
      hidden={!open}
      aria-labelledby={`question-panel-heading-${slotId}`}
      onKeyDown={onKeyDown}
    >
      <h3 id={`question-panel-heading-${slotId}`} ref={headingRef} tabIndex={-1} className="question-panel__heading">
        {heading}
      </h3>
      {LockPanel === undefined ? (
        <p className="question-panel__unplayable">{ROOM_PLAY_LABELS.unplayableType}</p>
      ) : (
        createElement(LockPanel, { slotId, questionId, questionType })
      )}
      {children}
    </section>
  );
}
