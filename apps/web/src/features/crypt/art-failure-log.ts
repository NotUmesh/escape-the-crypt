// One console.error per distinct art file per room mount (Requirements 23.1, 23.4).
// Only the file name and the error type are logged, never learner content.

export type ArtErrorType = 'art-load-failed' | 'scene-load-failed';

export type ArtFailureLog = (file: string, errorType: ArtErrorType) => void;

/** Create one per room mount. Repeat failures of the same file are ignored. */
export function createArtFailureLog(): ArtFailureLog {
  const seen = new Set<string>();
  return (file, errorType) => {
    if (seen.has(file)) return;
    seen.add(file);
    console.error({ file, errorType });
  };
}
