import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { DESK_PROPS, deskPropFile, readDeskPlacement } from './desk-props';

const root = join(process.cwd(), 'public', 'art', 'desk');
const raw: unknown = JSON.parse(readFileSync(join(root, 'scene.json'), 'utf8'));

describe('desk scene contract', () => {
  it('can place all five shipped props and has the background and every desktop layer', () => {
    const placement = readDeskPlacement(raw);
    expect(placement).not.toBeNull();
    expect([...placement?.props.keys() ?? []]).toEqual([...DESK_PROPS]);
    for (const file of [
      'desktop/background.webp', 'desktop/background@2x.webp', 'desktop/candle.webp', 'desktop/foreground.webp',
      'desktop/window-ghost.webp', 'desktop/window-lightning.webp',
      ...DESK_PROPS.flatMap((prop) => [deskPropFile(prop), deskPropFile(prop, true)]),
    ]) expect(existsSync(join(root, file)), file).toBe(true);
  });

  it('rejects invalid hotspot geometry so the desk can fall back to ordinary controls', () => {
    if (typeof raw !== 'object' || raw === null || !('desktop' in raw) ||
        typeof raw.desktop !== 'object' || raw.desktop === null || !('props' in raw.desktop)) throw new Error('Bad fixture');
    const props = raw.desktop.props;
    if (typeof props !== 'object' || props === null) throw new Error('Bad prop fixture');
    expect(readDeskPlacement({
      ...raw,
      desktop: { ...raw.desktop, props: { ...props, 'notes-book': { label: { x: 0.5, y: 0.5 }, hotspot: [[0, 0], [1, 0], [2, 1]] } } },
    })).toBeNull();
  });
});
