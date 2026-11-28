import type { ReactNode } from 'react';
import { usePrefersReducedMotion } from '../use-prefers-reduced-motion';
import './quill-mark.css';

/**
 * A quill and a line of ink for the Autopsy heading. Decoration only: it draws no text, reads no
 * learner content and takes no focus or pointer. The finished stroke is the resting picture; the
 * stylesheet writes it out over 900 ms only when motion is allowed.
 */
export function QuillMark(): ReactNode {
  const reduced = usePrefersReducedMotion();
  return (
    <svg
      className="quill-mark"
      viewBox="0 0 120 40"
      width="120"
      height="40"
      aria-hidden="true"
      focusable="false"
      data-reduced-motion={reduced ? 'true' : 'false'}
    >
      <path
        className="quill-mark__stroke"
        d="M8 32 C 28 24, 44 36, 64 28 S 96 30, 108 26"
        pathLength="1"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
      <g className="quill-mark__quill" fill="currentColor">
        <path d="M108 26 L 118 6 C 112 8, 104 14, 100 24 Z" />
      </g>
    </svg>
  );
}
