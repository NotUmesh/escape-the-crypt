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

  it('includes the bound-threads rule text only when allowed via options', () => {
    const system = buildGenerationSystemPrompt([...DEFAULT_ALLOWED_LOCK_TYPES, 'bound-threads']);
    expect(system).toContain('bound-threads (match 3 or 4 pairs)');
    expect(system).toContain('strictly one-to-one');
    expect(system).toContain('never infer a pairing the notes do not state');
    const base = buildGenerationSystemPrompt(DEFAULT_ALLOWED_LOCK_TYPES);
    expect(base).not.toContain('bound-threads');
    expect(base).not.toContain('pairs lists');
  });

  it('includes the cursed-object rule text only when allowed via options', () => {
    const system = buildGenerationSystemPrompt([...DEFAULT_ALLOWED_LOCK_TYPES, 'cursed-object']);
    expect(system).toContain('cursed-object (find the odd one out)');
    expect(system).toContain('explicit category and exactly one item outside it');
    expect(system).toContain('items lists exactly 4 items');
    expect(system).toContain("answer is the odd item's text, copied exactly from items");
    expect(system).toContain('categoryRule states the category');
    expect(system).toContain('Never infer the odd item from outside knowledge');
    const base = buildGenerationSystemPrompt(DEFAULT_ALLOWED_LOCK_TYPES);
    expect(base).not.toContain('cursed-object');
    expect(base).not.toContain('categoryRule');
  });

  it('does not widen the default allowed types', () => {
    expect(DEFAULT_ALLOWED_LOCK_TYPES).toEqual(['rune-cipher', 'seance-board']);
  });
});
