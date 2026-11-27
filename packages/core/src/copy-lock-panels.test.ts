import { describe, expect, it } from 'vitest';
import { BANNED_COPY_PHRASES } from './copy';
import { LOCK_PANEL_LABELS } from './copy-lock-panels';

function strings(): string[] {
  return Object.values(LOCK_PANEL_LABELS).flatMap((v) =>
    typeof v === 'string' ? [v] : [(v as (...a: never[]) => string)(...(Array(3).fill('x') as never[])), (v as (...a: never[]) => string)(...(Array(3).fill(1) as never[]))],
  );
}
describe('lock panel copy', () => {
  it('has no banned phrase', () => {
    for (const text of strings()) {
      const lower = text.toLowerCase();
      expect(BANNED_COPY_PHRASES.filter((p) => lower.includes(p.toLowerCase()))).toEqual([]);
    }
  });
});
