import { useEffect, useState } from 'react';
import { loadCrypt } from '../../state/storage/crypt-repository';
import { findResumable } from '../../state/storage/run-repository';
import type { ShelfEntry } from './shelf-entry';

export type ShelfLoader = () => Promise<readonly ShelfEntry[]>;

const NONE: readonly ShelfEntry[] = [];

/**
 * The shelf until `listShelf` exists in `state/storage`: at most one book, from the latest active
 * run. Reads only; a missing or unreadable record gives an empty shelf. Swap it for the real
 * loader at integration; nothing else changes.
 */
export function interimShelfLoader(factory: IDBFactory | undefined): ShelfLoader {
  return async () => {
    const found = await findResumable(factory);
    if (!found.ok || found.value === null) return NONE;
    const run = found.value;
    const crypt = await loadCrypt(factory, run.manifestId);
    if (!crypt.ok) return NONE;
    return [
      {
        manifestId: run.manifestId,
        runId: run.runId,
        status: run.status,
        createdAt: run.createdAt,
        source: crypt.value.source,
        roomCount: crypt.value.manifest.rooms.length,
      },
    ];
  };
}

/** Loads the shelf once when the hub mounts, newest first. A failed load shows an empty shelf. */
export function useShelf(load: ShelfLoader): readonly ShelfEntry[] {
  const [entries, setEntries] = useState<readonly ShelfEntry[]>(NONE);
  useEffect(() => {
    let alive = true;
    load().then(
      (loaded) => {
        if (alive) setEntries([...loaded].sort((a, b) => b.createdAt - a.createdAt));
      },
      () => {
        if (alive) setEntries(NONE);
      },
    );
    return () => {
      alive = false;
    };
  }, [load]);
  return entries;
}
