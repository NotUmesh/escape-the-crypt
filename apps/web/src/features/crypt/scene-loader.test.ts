import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { loadScene, sceneUrl } from './scene-loader';
import type { SceneFetch } from './scene-loader';
import { SceneFileSchema } from './scene-types';

const ROOMS_DIR = join(dirname(fileURLToPath(import.meta.url)), '../../../public/art/rooms');
const ART_ROOMS = ['burial-chamber', 'library-of-bones', 'sunken-chapel'] as const;

function readScene(room: string): unknown {
  return JSON.parse(readFileSync(join(ROOMS_DIR, room, 'scene.json'), 'utf8'));
}

function fetchJson(body: unknown, init?: ResponseInit): SceneFetch {
  return () => Promise.resolve(new Response(JSON.stringify(body), init));
}

describe('SceneFile schema', () => {
  it.each(ART_ROOMS)('accepts the real %s/scene.json', (room) => {
    const result = SceneFileSchema.safeParse(readScene(room));
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.room).toBe(room);
      expect(Object.keys(result.data.desktop.locks)).toHaveLength(6);
      expect(result.data.mobile).toBeUndefined();
    }
  });

  it('accepts an optional mobile block of the same shape', () => {
    const file = readScene('burial-chamber') as { desktop: unknown };
    expect(SceneFileSchema.safeParse({ ...file, mobile: file.desktop }).success).toBe(true);
  });

  it('rejects an unknown lock type, a bad panelSide and out-of-range positions', () => {
    const file = readScene('burial-chamber') as { desktop: { locks: Record<string, unknown> } };
    const entry = file.desktop.locks['rune-cipher'] as object;
    const withLocks = (locks: Record<string, unknown>): unknown => ({
      ...file,
      desktop: { ...file.desktop, locks },
    });
    expect(SceneFileSchema.safeParse(withLocks({ 'mystery-lock': entry })).success).toBe(false);
    expect(
      SceneFileSchema.safeParse(withLocks({ 'rune-cipher': { ...entry, panelSide: 'up' } })).success,
    ).toBe(false);
    expect(
      SceneFileSchema.safeParse(
        withLocks({ 'rune-cipher': { ...entry, hotspot: [[2, 0], [0, 0], [0, 1]] } }),
      ).success,
    ).toBe(false);
  });
});

describe('loadScene', () => {
  it('requests the same-origin scene.json for the art room', async () => {
    let requested = '';
    const spy: SceneFetch = (url) => {
      requested = url;
      return Promise.resolve(new Response(JSON.stringify(readScene('sunken-chapel'))));
    };
    const result = await loadScene('sunken-chapel', spy);
    expect(requested).toBe('/art/rooms/sunken-chapel/scene.json');
    expect(requested).toBe(sceneUrl('sunken-chapel'));
    expect(result.ok).toBe(true);
  });

  it.each(ART_ROOMS)('loads %s', async (room) => {
    const result = await loadScene(room, fetchJson(readScene(room)));
    expect(result.ok).toBe(true);
  });

  it('reports a missing field with its path', async () => {
    const file = readScene('library-of-bones') as { desktop: Record<string, unknown> };
    const desktop = Object.fromEntries(Object.entries(file.desktop).filter(([k]) => k !== 'door'));
    const result = await loadScene('library-of-bones', fetchJson({ ...file, desktop }));
    expect(result).toEqual({ ok: false, error: { kind: 'invalid', paths: ['desktop.door'] } });
  });

  it('reports a missing top-level desktop block', async () => {
    const result = await loadScene('burial-chamber', fetchJson({ room: 'burial-chamber', version: 1 }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.kind).toBe('invalid');
  });

  it('reports a malformed file', async () => {
    const result = await loadScene('burial-chamber', () =>
      Promise.resolve(new Response('{ not json')),
    );
    expect(result).toEqual({ ok: false, error: { kind: 'malformed' } });
  });

  it('reports a network failure without throwing', async () => {
    const result = await loadScene('burial-chamber', () => Promise.reject(new TypeError('offline')));
    expect(result).toEqual({ ok: false, error: { kind: 'network' } });
  });

  it('reports an HTTP error status', async () => {
    const result = await loadScene('burial-chamber', fetchJson({}, { status: 404 }));
    expect(result).toEqual({ ok: false, error: { kind: 'http', status: 404 } });
  });
});
