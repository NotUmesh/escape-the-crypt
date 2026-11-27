import { isAbsolute, relative, resolve, sep } from 'node:path';

/** Reads stdin until it ends, or until `timeoutMs` passes with nothing more. Returns '' when stdin is a terminal. */
export async function readStdin(timeoutMs = 1000): Promise<string> {
  if (process.stdin.isTTY) return '';
  return new Promise<string>((done) => {
    let data = '';
    const finish = (): void => {
      clearTimeout(timer);
      process.stdin.removeAllListeners();
      process.stdin.pause();
      done(data);
    };
    const timer = setTimeout(finish, timeoutMs);
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (chunk: string) => {
      data += chunk;
    });
    process.stdin.on('end', finish);
    process.stdin.on('error', finish);
  });
}

const PATH_KEYS = ['file_path', 'filePath', 'path', 'file'] as const;

/** The first file path in a hook's JSON input, whatever the nesting (the hook payload has changed shape before). */
export function findFilePath(value: unknown, depth = 0): string | undefined {
  if (typeof value !== 'object' || value === null || depth > 4) return undefined;
  const record = value as Record<string, unknown>;
  for (const key of PATH_KEYS) {
    const candidate = record[key];
    if (typeof candidate === 'string' && candidate.length > 0) return candidate;
  }
  for (const nested of Object.values(record)) {
    const found = findFilePath(nested, depth + 1);
    if (found !== undefined) return found;
  }
  return undefined;
}

/** The saved file's path from the hook's stdin text, or undefined for empty or unreadable input. */
export function filePathFromInput(raw: string): string | undefined {
  const text = raw.trim();
  if (text === '') return undefined;
  try {
    return findFilePath(JSON.parse(text));
  } catch {
    return undefined;
  }
}

/** `--file <path>` from the command line, so a hook script can also be run by hand. */
export function filePathFromArgs(argv: readonly string[]): string | undefined {
  const at = argv.indexOf('--file');
  const value = at >= 0 ? argv[at + 1] : undefined;
  return value === undefined || value.startsWith('--') ? undefined : value;
}

/**
 * The path relative to the repository root, with forward slashes, or undefined when the file is
 * outside the repository. Accepts absolute paths in either slash style, and paths already relative.
 */
export function repoRelative(root: string, filePath: string): string | undefined {
  const absolute = isAbsolute(filePath) ? filePath : resolve(root, filePath);
  const rel = relative(root, absolute);
  if (rel === '' || rel.startsWith('..') || isAbsolute(rel)) return undefined;
  return rel.split(sep).join('/');
}
