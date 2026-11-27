import type { Result } from '@escape-the-crypt/core';
import { SceneFileSchema } from './scene-types';
import type { SceneFile, SceneFileError } from './scene-types';

export type SceneFetch = (url: string) => Promise<Response>;

export function sceneUrl(artRoom: string): string {
  return `/art/rooms/${artRoom}/scene.json`;
}

/**
 * Fetches and validates one Art_Room's scene.json (same-origin). Never throws: every failure is a
 * typed result for the plain-button fallback (Requirement 23.3). Error values carry no response text.
 */
export async function loadScene(
  artRoom: string,
  fetchImpl: SceneFetch = (url) => fetch(url),
): Promise<Result<SceneFile, SceneFileError>> {
  let response: Response;
  try {
    response = await fetchImpl(sceneUrl(artRoom));
  } catch {
    return { ok: false, error: { kind: 'network' } };
  }
  if (!response.ok) return { ok: false, error: { kind: 'http', status: response.status } };
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    return { ok: false, error: { kind: 'malformed' } };
  }
  const parsed = SceneFileSchema.safeParse(body);
  if (!parsed.success) {
    const paths = parsed.error.issues.map((issue) => issue.path.join('.'));
    return { ok: false, error: { kind: 'invalid', paths } };
  }
  return { ok: true, value: parsed.data };
}
