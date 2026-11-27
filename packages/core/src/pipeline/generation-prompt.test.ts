import { describe, expect, it } from 'vitest';
import { DEFAULT_ALLOWED_LOCK_TYPES, buildGenerationSystemPrompt } from './generation-prompt';

describe('generation prompt: bone-ordering rule', () => {
  it('includes the rule text when bone-ordering is allowed via options', () => {
    const system = buildGenerationSystemPrompt([...DEFAULT_ALLOWED_LOCK_TYPES, 'bone-ordering']);
    expect(system).toContain('bone-ordering (put 3 to 5 steps in order)');
    expect(system).toContain('first/next/then/finally-style wording');
    expect(system).toContain('steps lists the 3 to 5 items in the correct order');
    expect(system).toContain('cycle or a process');
  });

  it('omits the rule text when bone-ordering is not allowed', () => {
    const system = buildGenerationSystemPrompt(DEFAULT_ALLOWED_LOCK_TYPES);
    expect(system).not.toContain('bone-ordering');
    expect(system).not.toContain('steps lists');
  });

  it('does not widen the default allowed types', () => {
    expect(DEFAULT_ALLOWED_LOCK_TYPES).toEqual(['rune-cipher', 'seance-board']);
  });
});
