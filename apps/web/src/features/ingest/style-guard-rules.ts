/**
 * Pure style-guard scanner. Takes a file path and its content and returns the
 * violations it finds. No file system access except through the injected
 * `fileExists` callback, so negative tests can feed it fixture strings.
 *
 * Two scopes:
 * - app-wide: every .css/.tsx/.ts file under apps/web
 * - ingest-only: files under apps/web/src/features/ingest/
 */

export type GuardRule =
  | 'colour-literal'
  | 'cross-origin-url'
  | 'google-fonts'
  | 'font-url'
  | 'viewport-unit'
  | 'position-fixed'
  | 'page-background'
  | 'background-image'
  | 'url-in-ingest'
  | 'candle-outside-lit';

export interface GuardViolation {
  readonly rule: GuardRule;
  readonly detail: string;
}

export interface ScanOptions {
  /** Returns true when a root-relative public path such as /fonts/a.woff2 exists. */
  readonly fileExists?: (publicPath: string) => boolean;
}

const TOKENS_PATH = 'apps/web/src/styles/tokens.css';
const INGEST_PREFIX = 'apps/web/src/features/ingest/';
const SVG_NAMESPACE = 'http://www.w3.org/2000/svg';
/** Hosts that never leave the machine or are reserved for tests (RFC 2606). */
const LOCAL_HOSTS: readonly string[] = ['localhost', '127.0.0.1', 'example.test'];
/** Only config, unit-test and e2e files may name those hosts; app source may not. */
const LOCAL_HOST_FILES = /\.(?:config|test|e2e)\.ts$/;

const NAMED_COLOURS = new Set(
  (
    'aliceblue antiquewhite aqua aquamarine azure beige bisque black blanchedalmond blue blueviolet brown ' +
    'burlywood cadetblue chartreuse chocolate coral cornflowerblue cornsilk crimson cyan darkblue darkcyan ' +
    'darkgoldenrod darkgray darkgreen darkgrey darkkhaki darkmagenta darkolivegreen darkorange darkorchid ' +
    'darkred darksalmon darkseagreen darkslateblue darkslategray darkslategrey darkturquoise darkviolet ' +
    'deeppink deepskyblue dimgray dimgrey dodgerblue firebrick floralwhite forestgreen fuchsia gainsboro ' +
    'ghostwhite gold goldenrod gray green greenyellow grey honeydew hotpink indianred indigo ivory khaki ' +
    'lavender lavenderblush lawngreen lemonchiffon lightblue lightcoral lightcyan lightgoldenrodyellow ' +
    'lightgray lightgreen lightgrey lightpink lightsalmon lightseagreen lightskyblue lightslategray ' +
    'lightslategrey lightsteelblue lightyellow lime limegreen linen magenta maroon mediumaquamarine ' +
    'mediumblue mediumorchid mediumpurple mediumseagreen mediumslateblue mediumspringgreen ' +
    'mediumturquoise mediumvioletred midnightblue mintcream mistyrose moccasin navajowhite navy oldlace ' +
    'olive olivedrab orange orangered orchid palegoldenrod palegreen paleturquoise palevioletred ' +
    'papayawhip peachpuff peru pink plum powderblue purple rebeccapurple red rosybrown royalblue ' +
    'saddlebrown salmon sandybrown seagreen seashell sienna silver skyblue slateblue slategray slategrey ' +
    'snow springgreen steelblue tan teal thistle tomato turquoise violet wheat white whitesmoke yellow ' +
    'yellowgreen'
  ).split(' '),
);

const LIT_SELECTOR = /\.(?:is-)?lit\b|\[data-(?:state|lit)(?:=["']?lit["']?)?\]|:lit\b/;
const COLOUR_PROP = /color|background|border|outline|fill|stroke|shadow|decoration|^--/;

const HEX = /(?<![\w&-])#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{3,4})(?![\w-])/g;
const COLOUR_FN = /(?<![\w$.-])(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch|color)\(/g;
const NAMED_IN_TS =
  /(?:color|background|border|outline|fill|stroke)[\w-]*['"]?\s*[:=]\s*['"]([a-zA-Z]+)['"]/gi;

function normalize(filePath: string): string {
  const p = filePath.replace(/\\/g, '/');
  const i = p.lastIndexOf('apps/web/');
  return i >= 0 ? p.slice(i) : p;
}

function stripComments(content: string, isCss: boolean): string {
  const noBlock = content.replace(/\/\*[\s\S]*?\*\//g, ' ');
  return isCss ? noBlock : noBlock.replace(/^\s*\/\/.*$/gm, '');
}

function findAll(re: RegExp, text: string): string[] {
  return Array.from(text.matchAll(re), (m) => m[0]);
}

function scanColours(text: string, isCss: boolean, out: GuardViolation[]): void {
  for (const m of findAll(HEX, text)) out.push({ rule: 'colour-literal', detail: m });
  for (const m of findAll(COLOUR_FN, text)) out.push({ rule: 'colour-literal', detail: m });
  if (isCss) {
    for (const d of text.matchAll(/([\w-]+)\s*:\s*([^;{}]+)/g)) {
      const prop = (d[1] ?? '').toLowerCase();
      if (!COLOUR_PROP.test(prop)) continue;
      const value = (d[2] ?? '')
        .replace(/var\([^)]*\)/g, ' ')
        .replace(/url\([^)]*\)/g, ' ')
        .replace(/(["'])(?:(?!\1).)*\1/g, ' ');
      for (const word of value.toLowerCase().split(/[^a-z]+/)) {
        if (NAMED_COLOURS.has(word)) out.push({ rule: 'colour-literal', detail: `${prop}: ${word}` });
      }
    }
  } else {
    for (const m of text.matchAll(NAMED_IN_TS)) {
      const word = (m[1] ?? '').toLowerCase();
      if (NAMED_COLOURS.has(word)) out.push({ rule: 'colour-literal', detail: m[0] });
    }
  }
}

function scanNetwork(text: string, allowLocalHosts: boolean, out: GuardViolation[]): void {
  if (/(?:fonts\.googleapis\.com|fonts\.gstatic\.com)/i.test(text)) {
    out.push({ rule: 'google-fonts', detail: 'Google Fonts host' });
  }
  for (const m of text.matchAll(/\b(?:https?|wss?|ftp):\/\/([^\s/'"`)\\:?#]+)[^\s'"`)]*/gi)) {
    const host = (m[1] ?? '').toLowerCase();
    if (m[0] === SVG_NAMESPACE || (allowLocalHosts && LOCAL_HOSTS.includes(host))) continue;
    out.push({ rule: 'cross-origin-url', detail: m[0] });
  }
  for (const m of text.matchAll(/url\(\s*['"]?(\/\/[^'")\s]+)/gi)) {
    out.push({ rule: 'cross-origin-url', detail: m[1] ?? m[0] });
  }
}

function scanFontUrls(text: string, options: ScanOptions, out: GuardViolation[]): void {
  for (const m of text.matchAll(/url\(\s*(['"]?)([^'")]*)\1\s*\)/gi)) {
    const url = m[2] ?? '';
    const okShape = /^\/fonts\/[A-Za-z0-9._-]+\.woff2$/.test(url);
    if (!okShape || (options.fileExists !== undefined && !options.fileExists(url))) {
      out.push({ rule: 'font-url', detail: url });
    }
  }
}

function enclosingSelector(text: string, index: number): string {
  const open = text.lastIndexOf('{', index);
  if (open < 0) return '';
  const start = Math.max(text.lastIndexOf('}', open), text.lastIndexOf(';', open), -1);
  return text.slice(start + 1, open);
}

function scanIngest(text: string, isCss: boolean, out: GuardViolation[]): void {
  for (const m of text.matchAll(/(?<![\w.])-?\d*\.?\d+(?:dvh|svh|vw|vh)\b/gi)) {
    out.push({ rule: 'viewport-unit', detail: m[0] });
  }
  for (const m of text.matchAll(/position['"]?\s*:\s*['"]?fixed/gi)) {
    out.push({ rule: 'position-fixed', detail: m[0] });
  }
  if (isCss) {
    for (const m of text.matchAll(/(?<![\w-])background\s*:/gi)) {
      out.push({ rule: 'page-background', detail: m[0] });
    }
    for (const m of text.matchAll(/url\(/gi)) out.push({ rule: 'url-in-ingest', detail: m[0] });
  }
  for (const m of text.matchAll(/background-image/gi)) {
    out.push({ rule: 'background-image', detail: m[0] });
  }
  for (const m of text.matchAll(/--candle-400/g)) {
    const selector = isCss ? enclosingSelector(text, m.index ?? 0) : '';
    if (!LIT_SELECTOR.test(selector)) {
      out.push({ rule: 'candle-outside-lit', detail: selector.trim() || m[0] });
    }
  }
}

export function scanFile(
  filePath: string,
  content: string,
  options: ScanOptions = {},
): GuardViolation[] {
  const path = normalize(filePath);
  if (!/\.(?:css|tsx?)$/.test(path)) return [];
  const isCss = path.endsWith('.css');
  const text = stripComments(content, isCss);
  const out: GuardViolation[] = [];

  if (path !== TOKENS_PATH) scanColours(text, isCss, out);
  scanNetwork(text, LOCAL_HOST_FILES.test(path), out);
  if (path.endsWith('/fonts.css')) scanFontUrls(text, options, out);
  if (path.startsWith(INGEST_PREFIX)) scanIngest(text, isCss, out);
  return out;
}
