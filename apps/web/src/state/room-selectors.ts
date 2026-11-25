import { z } from '@escape-the-crypt/core';
import type { Event } from '@escape-the-crypt/core';

const ChosenOptionSubmission = z.object({ selectedOptionId: z.string() });

/**
 * The option id from the latest accepted AnswerSubmitted Event for `slotId`, or undefined when
 * there is none or its submission carries no string `selectedOptionId` (for example rune `{ text }`).
 * Reads only the Event_Log, never State. Rejected submissions are absent from the log.
 */
export function chosenOptionFor(eventLog: readonly Event[], slotId: string): string | undefined {
  for (let i = eventLog.length - 1; i >= 0; i -= 1) {
    const event = eventLog[i];
    if (event === undefined || event.kind !== 'AnswerSubmitted' || event.slotId !== slotId) continue;
    const parsed = ChosenOptionSubmission.safeParse(event.submission);
    return parsed.success ? parsed.data.selectedOptionId : undefined;
  }
  return undefined;
}
