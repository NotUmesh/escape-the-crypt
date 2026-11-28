export interface DescentClip {
  readonly webm: string;
  readonly mp4: string;
  readonly poster: string;
}

/**
 * The descent in two clips: the desk candle snuffed, then down into the first room. Both are the
 * desktop 1920x1080 clips; phones show them centre-cropped (`object-fit: cover`). WebM first, MP4
 * as the fallback. No clip has an audio track.
 */
export const DESCENT_CLIPS: readonly DescentClip[] = [
  {
    webm: '/art/motion/descent-desk.webm',
    mp4: '/art/motion/descent-desk.mp4',
    poster: '/art/motion/descent-desk-poster.webp',
  },
  {
    webm: '/art/motion/descent.webm',
    mp4: '/art/motion/descent.mp4',
    poster: '/art/motion/descent-poster.webp',
  },
];

export type EndgameClip = 'final-door' | 'escape';

export function endgameClips(clip: EndgameClip): readonly DescentClip[] {
  const path = `/art/motion/${clip}`;
  return [{ webm: `${path}.webm`, mp4: `${path}.mp4`, poster: `${path}-poster.webp` }];
}

/** How long a clip may take to become playable before the descent gives up on it (ms). */
export const CAN_PLAY_TIMEOUT_MS = 1500;
