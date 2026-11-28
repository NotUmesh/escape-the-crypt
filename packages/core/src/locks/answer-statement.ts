import type { AuthoringQuestion } from '../authoring/schema';

/**
 * Cross-type helper: renders the key answer of an authoring question as one plain-text line.
 * It holds no per-type rule beyond turning a key into text. Pure, never throws, and reads every
 * field defensively because authoring questions can reach it before their Code_Checks have run.
 */

const NO_UNITS = '(no units)';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '';
}

function list(value: unknown): readonly unknown[] {
  return Array.isArray(value) ? value : [];
}

function num(value: unknown): string {
  return typeof value === 'number' && Number.isFinite(value) ? String(value) : '';
}

function withUnit(value: string, unitsRaw: unknown): string {
  const units = text(unitsRaw);
  if (value === '') return '';
  return units === '' || units === NO_UNITS ? value : `${value} ${units}`;
}

function runeLine(q: Record<string, unknown>): string {
  return text(q['answer']);
}

function seanceLine(q: Record<string, unknown>): string {
  const key = text(q['answer']);
  for (const option of list(q['options'])) {
    if (isRecord(option) && text(option['id']) === key) return text(option['text']);
  }
  return '';
}

function boneLine(q: Record<string, unknown>): string {
  return list(q['steps'])
    .map(text)
    .filter((s) => s !== '')
    .map((s, i) => `${i + 1}. ${s}`)
    .join('; ');
}

function threadsLine(q: Record<string, unknown>): string {
  const pairs: string[] = [];
  for (const pair of list(q['pairs'])) {
    if (!isRecord(pair)) continue;
    const left = text(pair['left']);
    const right = text(pair['right']);
    if (left !== '' && right !== '') pairs.push(`${left} = ${right}`);
  }
  return pairs.join('; ');
}

function cursedLine(q: Record<string, unknown>): string {
  return text(q['answer']);
}

function dialLine(q: Record<string, unknown>): string {
  const answer = q['answer'];
  if (!isRecord(answer)) return '';
  if (answer['kind'] === 'range') {
    const min = num(answer['min']);
    const max = num(answer['max']);
    if (min === '' || max === '') return '';
    const range = `${min} to ${max}`;
    const units = text(q['units']);
    return units === '' || units === NO_UNITS ? range : `${range} ${units}`;
  }
  // 'exact' and 'template' both carry the stated value; a template's value is only rendered, never computed here.
  return withUnit(num(answer['value']), q['units']);
}

/** One plain-text line for the key answer, or an empty string when the question has none to show. */
export function statedAnswerOf(question: AuthoringQuestion): string {
  try {
    const q: unknown = question;
    if (!isRecord(q)) return '';
    switch (q['lockType']) {
      case 'rune-cipher':
        return runeLine(q);
      case 'seance-board':
        return seanceLine(q);
      case 'bone-ordering':
        return boneLine(q);
      case 'bound-threads':
        return threadsLine(q);
      case 'cursed-object':
        return cursedLine(q);
      case 'combination-dial':
        return dialLine(q);
      default:
        return '';
    }
  } catch {
    return '';
  }
}
