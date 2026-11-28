import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { auditCss } from './motion-css-audit';

/**
 * Report-only: lists motion gaps in the screens outside the crypt feature. It edits nothing and
 * passes. The findings feed Open_Decision 4 in .kiro/specs/haunting-polish.
 */
const SRC = join(process.cwd(), 'src', 'features');
const SCREENS = ['desk', 'dig', 'descent', 'start'];

function filesUnder(dir: string, test: (name: string) => boolean): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? filesUnder(path, test) : test(name) ? [path] : [];
  });
}

describe('motion outside the crypt feature (report only)', () => {
  it('lists every finding and edits nothing', () => {
    const findings: string[] = [];
    for (const screen of SCREENS) {
      const dir = join(SRC, screen);
      for (const css of filesUnder(dir, (n) => n.endsWith('.css'))) {
        for (const finding of auditCss(readFileSync(css, 'utf8'))) {
          findings.push(`${css.slice(SRC.length + 1)}: ${finding}`);
        }
      }
    }
    console.info(`Haunting polish audit, ${findings.length} finding(s):\n${findings.join('\n')}`);
    expect(Array.isArray(findings)).toBe(true);
  });
});
