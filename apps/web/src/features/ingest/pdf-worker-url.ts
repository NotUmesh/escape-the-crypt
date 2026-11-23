/** File name of the self-hosted pdf.js worker in `apps/web/public`. */
export const PDF_WORKER_FILE = 'pdf.worker.min.mjs';

/**
 * Builds the absolute URL of the pdf.js worker from Vite's `BASE_URL`, so the
 * app still works when served from a subpath such as `/crypt/`.
 * `baseUrl` must be an absolute path ("/" or "/crypt/"); a missing trailing
 * slash is added.
 */
export function pdfWorkerUrl(baseUrl: string, origin: string): string {
  const base = baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`;
  return new URL(`${base}${PDF_WORKER_FILE}`, origin).href;
}
