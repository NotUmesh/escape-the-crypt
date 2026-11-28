import { JobAckResponseSchema, JobStatusResponseSchema } from '@escape-the-crypt/core';
import type {
  CryptBundle,
  JobAckResponse,
  JobBundle,
  JobFailureKindName,
  JobStatusResponse,
} from '@escape-the-crypt/core';

/**
 * Bodies exactly as the worker sends them. Each builder is typed from core's inferred types
 * (so a shape change fails typecheck) and parsed with core's schemas (so a value that drifts
 * from the contract throws here, in the fake, instead of passing silently).
 * Used by the unit tests and by the e2e fake worker.
 */
export function checkedStatus(body: JobStatusResponse): JobStatusResponse {
  const parsed = JobStatusResponseSchema.safeParse(body);
  if (!parsed.success) throw new Error(`fake worker body breaks the contract at ${parsed.error.issues[0]?.path.join('.')}`);
  return body;
}

export function checkedAck(body: JobAckResponse): JobAckResponse {
  if (!JobAckResponseSchema.safeParse(body).success) throw new Error('fake worker ack breaks the contract');
  return body;
}

export const FAKE_JOB_ID = 'job-1';

export function ackBody(status: JobAckResponse['status'], jobId = FAKE_JOB_ID): JobAckResponse {
  return checkedAck({ jobId, status });
}

export function plainBody(
  status: 'queued' | 'running' | 'cancelling' | 'expired',
  jobId = FAKE_JOB_ID,
): JobStatusResponse {
  return checkedStatus({ jobId, status });
}

/** The message is the worker's own copy; the web never shows it. */
export const FAKE_FAILURE_MESSAGE = 'Worker copy that the app must not show.';

export function failureBody(
  status: 'failed' | 'cancelled',
  kind: JobFailureKindName,
  jobId = FAKE_JOB_ID,
): JobStatusResponse {
  return checkedStatus({ jobId, status, failure: { kind, message: FAKE_FAILURE_MESSAGE } });
}

/** `notices`: what a worker sends only to a client that asked with `?notices=1`. */
export function completedBody(
  bundle: CryptBundle,
  jobId = FAKE_JOB_ID,
  notices?: NonNullable<JobBundle['notices']>,
): JobStatusResponse {
  return checkedStatus({
    jobId,
    status: 'completed',
    bundle: {
      manifest: bundle.manifest,
      content: bundle.content,
      unplacedAccepted: [],
      ...(notices === undefined ? {} : { notices }),
    },
  });
}
