import type { DocumentInitParameters } from 'pdfjs-dist/types/src/display/api';

/** `DocumentInitParameters` plus the scripting switch, which pdf.js reads but does not type. */
export type SafeDocumentParams = DocumentInitParameters & { enableScripting: false };

/**
 * The options every PDF is opened with. Embedded actions and JavaScript are off.
 * No password callback is set, so an encrypted file fails instead of prompting.
 * Worker fetch and system fonts are off, so nothing is requested from another origin.
 */
export function safeDocumentParams(fileBuffer: ArrayBuffer): SafeDocumentParams {
  return {
    data: new Uint8Array(fileBuffer),
    enableScripting: false,
    useWorkerFetch: false,
    useSystemFonts: false,
  };
}