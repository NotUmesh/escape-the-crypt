/**
 * Generates the fixture PDFs used by the extraction tests.
 * Run with `pnpm --filter @escape-the-crypt/web fixtures` (Node 22 strips the types).
 * The encrypted fixture is not made here: see README.md in this folder.
 * `buildOversizedPdf` is not written to disk; tests call it, so no 5 MB file is committed.
 */
import { deflateSync, crc32 } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  PDFDocument,
  PDFName,
  PDFOperator,
  PDFOperatorNames,
  PDFString,
  StandardFonts,
  beginText,
  endText,
  moveText,
  setFontAndSize,
} from 'pdf-lib';
import type { PDFPage } from 'pdf-lib';

/** Same value as MAX_FILE_SIZE_BYTES in packages/core. Kept literal so this script has no workspace imports. */
const FIVE_MIB = 5 * 1024 * 1024;
const LINE_PITCH = 15;
const PARAGRAPH_PITCH = 34;

const PROSE = [
  'Spaced repetition schedules each review just before the learner would forget the item.',
  'The interval between reviews grows after every correct answer and shrinks after a miss.',
  'A short quiz at the start of a session asks the learner to recall facts from the last one.',
  'Active recall means producing an answer from memory instead of re-reading the notes.',
  'Mixing related topics in one session is called interleaving, and it helps learners tell similar ideas apart.',
  'A worked example shows each step of a solution so the learner can follow the reasoning.',
];

/** Greedy word wrap on character count. */
function wrap(text: string, maxChars: number): string[] {
  const lines: string[] = [];
  let line = '';
  for (const word of text.split(' ')) {
    if (line !== '' && line.length + 1 + word.length > maxChars) {
      lines.push(line);
      line = word;
    } else {
      line = line === '' ? word : `${line} ${word}`;
    }
  }
  if (line !== '') lines.push(line);
  return lines;
}

/** `n` words of deterministic prose. */
function proseWords(n: number): string {
  const words = PROSE.join(' ').split(' ');
  return Array.from({ length: n }, (_, i) => words[i % words.length]).join(' ');
}

/** Draws lines top to bottom; a `null` entry leaves a paragraph gap. */
function drawLines(page: PDFPage, font: Parameters<PDFPage['setFont']>[0], lines: (string | null)[], size = 11): void {
  let y = page.getHeight() - 60;
  page.setFont(font);
  let afterGap = false;
  for (const line of lines) {
    if (line === null) {
      afterGap = true;
      continue;
    }
    y -= afterGap ? PARAGRAPH_PITCH : LINE_PITCH;
    afterGap = false;
    page.drawText(line, { x: 56, y, size });
  }
}

/** No creation date or producer, so regenerating gives identical bytes. */
function newDocument(): Promise<PDFDocument> {
  return PDFDocument.create({ updateMetadata: false });
}

async function textPdf(pages: (string | null)[][], size = 11): Promise<Uint8Array> {
  const doc = await newDocument();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (const lines of pages) drawLines(doc.addPage([612, 792]), font, lines, size);
  return doc.save({ useObjectStreams: false });
}

export const buildOkPage = (): Promise<Uint8Array> => textPdf([wrap(proseWords(70), 80)]);

export const buildElevenPages = (): Promise<Uint8Array> =>
  textPdf(Array.from({ length: 11 }, (_, i) => wrap(`Page ${i + 1}. ${proseWords(40)}`, 80)));

/** 10 pages of 650 words: 6,500 words, over the 6,000-word limit. */
export const buildOverWordLimit = (): Promise<Uint8Array> =>
  textPdf(Array.from({ length: 10 }, () => wrap(proseWords(650), 130)), 7);

/** Twelve short rows (3 words, 8 to 11 characters each): over 20 words, median line under 12 characters. */
export const buildTableLike = (): Promise<Uint8Array> =>
  textPdf([Array.from({ length: 12 }, (_, i) => `R${i + 1}  ${i}  ${i * 2}`)]);

/**
 * Three paragraphs. The second ends a line with "exam-" and continues with "ple",
 * so a quote can span the hyphen break.
 */
export const buildThreeParagraphs = (): Promise<Uint8Array> =>
  textPdf([
    [
      ...wrap(
        'Spaced repetition schedules each review just before the learner would forget the item. The interval grows after every correct answer.',
        78,
      ),
      null,
      'Active recall means producing an answer from memory. A good exam-',
      'ple is closing the book and writing down what you remember before checking the notes.',
      null,
      ...wrap(
        'Interleaving mixes related topics in one session, which helps learners tell similar ideas apart during later review.',
        78,
      ),
    ],
  ]);

/** Three pages whose printed labels are roman numerals (i, ii, iii), so label and page number differ. */
export async function buildPrintedLabels(): Promise<Uint8Array> {
  const doc = await newDocument();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const pages = [0, 1, 2].map(() => doc.addPage([612, 792]));
  pages.forEach((page, i) =>
    drawLines(page, font, wrap(`${['Alpha', 'Bravo', 'Charlie'][i]} notes. ${proseWords(40)}`, 80)),
  );
  doc.catalog.set(PDFName.of('PageLabels'), doc.context.obj({ Nums: [0, { S: 'r' }] }));
  return doc.save({ useObjectStreams: false });
}

/** A prose page whose catalog has an OpenAction that runs JavaScript. */
export async function buildEmbeddedJavaScript(): Promise<Uint8Array> {
  const doc = await newDocument();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  drawLines(doc.addPage([612, 792]), font, wrap(proseWords(60), 80));
  const action = doc.context.obj({
    Type: 'Action',
    S: 'JavaScript',
    JS: PDFString.of('app.alert("fixture script");'),
  });
  doc.catalog.set(PDFName.of('OpenAction'), doc.context.register(action));
  return doc.save({ useObjectStreams: false });
}

/** A 16x16 grey PNG, built by hand so no image library is needed. */
function tinyPng(): Uint8Array {
  const chunk = (type: string, data: Uint8Array): Buffer => {
    const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const out = Buffer.alloc(body.length + 8);
    out.writeUInt32BE(data.length, 0);
    body.copy(out, 4);
    out.writeUInt32BE(crc32(body), body.length + 4);
    return out;
  };
  const size = 16;
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header.set([8, 0, 0, 0, 0], 8); // 8-bit grey, no interlace
  const rows = Buffer.alloc((size + 1) * size);
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) rows[y * (size + 1) + 1 + x] = (x * 16 + y * 8) & 0xff;
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(rows)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/** One page that is only an image, so it has no text layer. */
export async function buildImageOnly(): Promise<Uint8Array> {
  const doc = await newDocument();
  const page = doc.addPage([612, 792]);
  const image = await doc.embedPng(tinyPng());
  page.drawImage(image, { x: 56, y: 400, width: 400, height: 300 });
  return doc.save({ useObjectStreams: false });
}

/**
 * Prose whose font maps every glyph to a private-use character (a broken
 * ToUnicode map), so extraction returns unreadable symbols.
 */
export async function buildGarbled(): Promise<Uint8Array> {
  const doc = await newDocument();
  const page = doc.addPage([612, 792]);
  const cmap = [
    '/CIDInit /ProcSet findresource begin 12 dict begin begincmap',
    '/CMapName /Fixture-UCS def /CMapType 2 def',
    '1 begincodespacerange <00> <FF> endcodespacerange',
    '1 beginbfrange <21> <7E> <E021> endbfrange',
    'endcmap CMapName currentdict /CMap defineresource pop end end',
  ].join('\n');
  const toUnicode = doc.context.register(doc.context.flateStream(cmap));
  const fontRef = doc.context.register(
    doc.context.obj({
      Type: 'Font',
      Subtype: 'Type1',
      BaseFont: 'Helvetica',
      Encoding: 'WinAnsiEncoding',
      ToUnicode: toUnicode,
    }),
  );
  const name = page.node.newFontDictionary('FGarbled', fontRef);
  const lines = wrap(proseWords(70), 80);
  const ops = [beginText(), setFontAndSize(name, 11), moveText(56, 730)];
  for (const line of lines) {
    ops.push(PDFOperator.of(PDFOperatorNames.ShowText, [PDFString.of(line)]), moveText(0, -LINE_PITCH));
  }
  page.pushOperators(...ops, endText());
  return doc.save({ useObjectStreams: false });
}

/**
 * A valid one-page PDF, padded with an unused stream so the file is just over
 * the 5 MiB limit. Not written to disk.
 */
export async function buildOversizedPdf(): Promise<Uint8Array> {
  const make = async (padBytes: number): Promise<Uint8Array> => {
    const doc = await newDocument();
    const font = await doc.embedFont(StandardFonts.Helvetica);
    drawLines(doc.addPage([612, 792]), font, wrap(proseWords(60), 80));
    doc.catalog.set(PDFName.of('FixturePadding'), doc.context.register(doc.context.stream(new Uint8Array(padBytes))));
    return doc.save({ useObjectStreams: false });
  };
  const first = await make(1024);
  return make(FIVE_MIB - first.length + 1024 + 1024);
}

const FILES: Record<string, () => Promise<Uint8Array>> = {
  'ok-page.pdf': buildOkPage,
  'eleven-pages.pdf': buildElevenPages,
  'over-word-limit.pdf': buildOverWordLimit,
  'image-only.pdf': buildImageOnly,
  'garbled.pdf': buildGarbled,
  'table-like.pdf': buildTableLike,
  'embedded-javascript.pdf': buildEmbeddedJavaScript,
  'three-paragraphs.pdf': buildThreeParagraphs,
  'printed-labels.pdf': buildPrintedLabels,
};

if (process.argv[1] !== undefined && fileURLToPath(import.meta.url) === process.argv[1]) {
  const out = dirname(fileURLToPath(import.meta.url));
  mkdirSync(out, { recursive: true });
  for (const [name, build] of Object.entries(FILES)) {
    const bytes = await build();
    writeFileSync(join(out, name), bytes);
    process.stdout.write(`${name}  ${bytes.length} bytes\n`);
  }
}