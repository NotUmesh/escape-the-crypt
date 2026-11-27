import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { DESCENT_CLIPS } from './clip-sources';

describe('DESCENT_CLIPS', () => {
  it('plays the desk part, then the crypt part', () => {
    expect(DESCENT_CLIPS.map((c) => c.webm)).toEqual(['/art/motion/descent-desk.webm', '/art/motion/descent.webm']);
  });

  it('names files that exist, with a poster for each', () => {
    for (const clip of DESCENT_CLIPS) {
      for (const path of [clip.webm, clip.mp4, clip.poster]) {
        expect(existsSync(join(process.cwd(), 'public', path)), path).toBe(true);
      }
    }
  });

  it('serves everything from this origin', () => {
    for (const clip of DESCENT_CLIPS) for (const path of [clip.webm, clip.mp4, clip.poster]) expect(path.startsWith('/')).toBe(true);
  });
});
