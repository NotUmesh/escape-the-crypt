import { useEffect, useState } from 'react';
import type { CryptNotices } from '../generate/generated-notices';
import type { GeneratedCrypt } from '../generate/generated-crypt';
import type { GenerationState } from '../generate/generation-flow';

/** The notices of the crypt a job just built, kept with that crypt's manifest ID. */
export interface HeldNotices {
  readonly manifestId: string;
  readonly notices: CryptNotices;
}

/**
 * Holds what a finished job left out. It is kept with the manifest ID of the crypt it belongs to, so
 * it shows only while that crypt is the one playing: Continue on another saved crypt, or a sample,
 * never shows it. Nothing is stored: a notice is shown from the job that made the crypt.
 */
export function useGeneratedNotices(status: GenerationState['status'], readyCrypt: () => GeneratedCrypt | null): HeldNotices | null {
  const [held, setHeld] = useState<HeldNotices | null>(null);
  useEffect(() => {
    if (status !== 'ready') return;
    const crypt = readyCrypt();
    setHeld(crypt?.notices === undefined ? null : { manifestId: crypt.manifest.manifestId, notices: crypt.notices });
  }, [status, readyCrypt]);
  return held;
}
