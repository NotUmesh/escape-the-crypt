import type { ReactNode } from 'react';
import { useLantern } from './lantern-context';
import './lantern-toggle.css';

export interface LanternToggleProps {
  /** The learner-facing name, from core copy. The name stays the same in both states; `aria-pressed` carries the state. */
  readonly label: string;
}

/** The Lantern_Mode control: a native toggle button (Requirement 12.5). */
export function LanternToggle({ label }: LanternToggleProps): ReactNode {
  const { lantern, setLantern } = useLantern();
  return (
    <button
      type="button"
      className="lantern-toggle"
      aria-pressed={lantern}
      onClick={() => setLantern(!lantern)}
    >
      {label}
    </button>
  );
}
