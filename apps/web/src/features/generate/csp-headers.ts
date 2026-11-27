import { parseWorkerOrigin } from "./worker-config";

const CONNECT_SRC = /(^|;\s*)connect-src([^;\r\n]*)/g;

/**
 * Adds the worker origin to the `connect-src` directive of every Content-Security-Policy line.
 * Everything else is returned byte for byte. A null origin leaves the text unchanged;
 * an origin that `parseWorkerOrigin` rejects throws, so nothing unvalidated is written.
 */
export function headersWithWorkerOrigin(text: string, origin: string | null): string {
  if (origin === null) return text;
  if (parseWorkerOrigin(origin) !== origin) {
    throw new Error("Refusing to write a worker origin that is not a bare, normalised origin.");
  }
  return text
    .split(/(\r?\n)/)
    .map((line) => {
      if (!/^\s*Content-Security-Policy:/i.test(line)) return line;
      return line.replace(CONNECT_SRC, (whole, lead: string, sources: string) =>
        sources.split(/\s+/).includes(origin) ? whole : `${lead}connect-src${sources.trimEnd()} ${origin}`,
      );
    })
    .join("");
}

