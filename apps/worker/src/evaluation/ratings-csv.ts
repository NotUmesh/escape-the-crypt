/**
 * Rater CSV: one row per rateable question. Raters fill `rater`, `verdict` (correct, wrong or
 * unsure) and `comment`. Import joins rows to the result file by note, concept_index and role, so
 * the other columns are context for the rater and are never trusted.
 */
export const BASE_COLUMNS = ['run_id', 'note', 'concept_index', 'concept_id', 'role', 'lock_type'] as const;
/** Left out of a blind export so raters cannot tell accepted from rejected. */
export const OUTCOME_COLUMNS = ['result', 'rejection_reason'] as const;
export const QUESTION_COLUMNS = ['prompt', 'answer', 'options', 'quotes', 'explanation'] as const;
export const RATER_COLUMNS = ['rater', 'verdict', 'comment'] as const;

export type Row = Readonly<Record<string, string>>;

export function columnsFor(blind: boolean): readonly string[] {
  return [...BASE_COLUMNS, ...(blind ? [] : OUTCOME_COLUMNS), ...QUESTION_COLUMNS, ...RATER_COLUMNS];
}

/**
 * Spreadsheet programs run a cell that starts with = + - @ as a formula, and prompts come from
 * learner notes and model output. A leading apostrophe makes the cell text. Rater-facing only:
 * import never reads these columns.
 */
function neutralise(value: string): string {
  return /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
}

function escape(value: string): string {
  return /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

const BOM = '\uFEFF';

/** UTF-8 with a BOM, so Excel reads the arrows and quotes correctly. */
export function toCsv(columns: readonly string[], rows: readonly Row[]): string {
  const lines = rows.map((row) => columns.map((c) => escape(neutralise(row[c] ?? ''))).join(','));
  return `${BOM}${[columns.join(','), ...lines].join('\r\n')}\r\n`;
}

/** RFC 4180: quoted fields may hold commas, quotes and line breaks. Strips a BOM. Null if a quote never closes. */
export function parseCsv(text: string): { readonly header: readonly string[]; readonly rows: readonly Row[] } | null {
  const records: string[][] = [];
  let record: string[] = [];
  let cell = '';
  let quoted = false;
  const src = text.startsWith(BOM) ? text.slice(1) : text;
  for (let i = 0; i < src.length; i += 1) {
    const ch = src[i] ?? '';
    if (quoted) {
      if (ch === '"' && src[i + 1] === '"') {
        cell += '"';
        i += 1;
      } else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') {
      record.push(cell);
      cell = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && src[i + 1] === '\n') i += 1;
      record.push(cell);
      records.push(record);
      record = [];
      cell = '';
    } else cell += ch;
  }
  if (quoted) return null;
  if (cell !== '' || record.length > 0) {
    record.push(cell);
    records.push(record);
  }
  const [header, ...body] = records;
  if (header === undefined) return null;
  const names = header.map((h) => h.trim());
  const rows = body
    .filter((r) => r.some((c) => c.trim() !== ''))
    .map((r) => Object.fromEntries(names.map((name, i) => [name, r[i] ?? ''] as const)));
  return { header: names, rows };
}
