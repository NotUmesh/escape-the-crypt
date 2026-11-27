import { DIG_STAGE_IDS, FRONT_OF_HOUSE_COPY } from '../desk/front-of-house-copy';
import type { DigStageId } from '../desk/front-of-house-copy';

/**
 * Pipeline progress as the dig shows it. This is the shape the job status is asked to carry
 * (`stage` and counts on `GET /jobs/:id`); nothing here is invented, and without it nothing renders.
 */
export interface DigStageInput {
  readonly id: string;
  readonly status: 'done' | 'active' | 'waiting';
  /** Real counts for this stage, when the job reports them. */
  readonly done?: number;
  readonly total?: number;
}

export interface DigStageRow {
  readonly id: DigStageId;
  readonly name: string;
  readonly status: DigStageInput['status'];
  readonly statusWord: string;
  /** "6 of 9", or null when no usable count was sent. */
  readonly count: string | null;
}

const KNOWN: ReadonlySet<string> = new Set(DIG_STAGE_IDS);

function isDigStageId(id: string): id is DigStageId {
  return KNOWN.has(id);
}

/** A count is shown only when it is a whole number, total above 0 and done within 0..total. */
function countText(done: number | undefined, total: number | undefined): string | null {
  if (done === undefined || total === undefined) return null;
  if (!Number.isInteger(done) || !Number.isInteger(total)) return null;
  if (total <= 0 || done < 0 || done > total) return null;
  return FRONT_OF_HOUSE_COPY.dig.stageCount(done, total);
}

/**
 * Rows for the stage list, in the pipeline's fixed order. Stage ids the app does not know are
 * dropped, so no text from the worker is ever shown. Returns an empty list when there is nothing real
 * to show.
 */
export function digStageRows(stages: readonly DigStageInput[] | undefined): readonly DigStageRow[] {
  if (stages === undefined) return [];
  const rows: DigStageRow[] = [];
  for (const id of DIG_STAGE_IDS) {
    const input = stages.find((stage) => stage.id === id && isDigStageId(stage.id));
    if (input === undefined) continue;
    rows.push({
      id,
      name: FRONT_OF_HOUSE_COPY.dig.stageNames[id],
      status: input.status,
      statusWord: FRONT_OF_HOUSE_COPY.dig.stageStatus[input.status],
      count: input.status === 'waiting' ? null : countText(input.done, input.total),
    });
  }
  return rows;
}

/** The sentence for the announcer when the active stage changes, or null when none is active. */
export function activeStageMessage(rows: readonly DigStageRow[]): string | null {
  const active = rows.find((row) => row.status === 'active');
  return active === undefined ? null : FRONT_OF_HOUSE_COPY.dig.stageNow(active.name, active.count);
}
