import type { IncomingMessage } from 'node:http';

export type BodyResult =
  | { readonly ok: true; readonly text: string }
  | { readonly ok: false; readonly kind: 'too-large' | 'aborted' };

/** Hard ceiling on bytes read from an oversized request: 8 times the limit (2 MB by default). */
export const DRAIN_CEILING_FACTOR = 8;
/** Longest an oversized request may keep uploading after the limit is passed. */
export const DRAIN_TIMEOUT_MS = 5000;

/**
 * Reads and discards the rest of an oversized request so the client can finish uploading and read
 * the 413. Nothing is buffered. The socket is destroyed past the byte ceiling or the timeout.
 */
export function drainRequest(req: IncomingMessage, alreadyRead: number, limitBytes: number): void {
  if (req.complete || req.destroyed) return;
  const ceiling = limitBytes * DRAIN_CEILING_FACTOR;
  let discarded = alreadyRead;
  const stop = (): void => {
    clearTimeout(timer);
    req.off('data', onData);
    req.off('end', stop);
    req.off('close', stop);
  };
  const abort = (): void => {
    stop();
    req.destroy();
    req.socket.destroy();
  };
  const onData = (chunk: Buffer): void => {
    discarded += chunk.length;
    if (discarded > ceiling) abort();
  };
  const timer = setTimeout(abort, DRAIN_TIMEOUT_MS);
  timer.unref();
  req.on('data', onData);
  req.on('end', stop);
  req.on('close', stop);
  req.on('error', stop);
  req.resume();
}

/**
 * Reads the request body as UTF-8 text with a hard byte limit. Reading stops as soon as the
 * limit is passed; bytes past it are never buffered. Never rejects.
 */
export function readBody(req: IncomingMessage, limitBytes: number): Promise<BodyResult> {
  const declared = Number(req.headers['content-length']);
  if (Number.isFinite(declared) && declared > limitBytes) {
    drainRequest(req, 0, limitBytes);
    return Promise.resolve({ ok: false, kind: 'too-large' });
  }
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    let total = 0;
    let settled = false;
    const finish = (result: BodyResult): void => {
      if (settled) return;
      settled = true;
      req.off('data', onData);
      req.off('end', onEnd);
      req.off('error', onError);
      req.off('aborted', onError);
      req.off('close', onClose);
      resolve(result);
    };
    const onData = (chunk: Buffer): void => {
      total += chunk.length;
      if (total > limitBytes) {
        chunks.length = 0;
        finish({ ok: false, kind: 'too-large' });
        drainRequest(req, total, limitBytes);
        return;
      }
      chunks.push(chunk);
    };
    const onEnd = (): void => {
      finish({ ok: true, text: Buffer.concat(chunks).toString('utf8') });
    };
    const onError = (): void => finish({ ok: false, kind: 'aborted' });
    const onClose = (): void => {
      if (!req.complete) finish({ ok: false, kind: 'aborted' });
    };
    req.on('data', onData);
    req.on('end', onEnd);
    req.on('error', onError);
    req.on('aborted', onError);
    req.on('close', onClose);
  });
}
