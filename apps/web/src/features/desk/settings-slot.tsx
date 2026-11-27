import type { ReactNode } from 'react';

/**
 * The place for the length and difficulty choice. It renders nothing for now. The task that builds
 * the choice replaces the body of this one component; it owns its own fieldset and legend, and the
 * book screen puts it between the "your notes are ready" summary and the Generate button.
 */
export function SettingsSlot(): ReactNode {
  return null;
}
