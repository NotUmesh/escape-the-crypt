import type { Page } from '@playwright/test';

export interface StoredRecord {
  readonly [key: string]: unknown;
}

/** Reads every record in the `notes` store and describes any binary value inside it. */
export async function readNotesStore(page: Page): Promise<{ records: StoredRecord[]; binary: string[] }> {
  return page.evaluate(
    () =>
      new Promise<{ records: StoredRecord[]; binary: string[] }>((resolve, reject) => {
        const open = indexedDB.open('escape-the-crypt', 1);
        open.onerror = () => reject(new Error('open failed'));
        open.onsuccess = () => {
          const all = open.result.transaction('notes').objectStore('notes').getAll();
          all.onsuccess = () => {
            const binary: string[] = [];
            const walk = (value: unknown, path: string): void => {
              if (value instanceof ArrayBuffer || ArrayBuffer.isView(value)) binary.push(`${path}: bytes`);
              else if (value instanceof Blob) binary.push(`${path}: blob`);
              else if (Array.isArray(value)) value.forEach((v, i) => walk(v, `${path}[${i}]`));
              else if (value !== null && typeof value === 'object') {
                for (const [k, v] of Object.entries(value)) walk(v, `${path}.${k}`);
              }
            };
            walk(all.result, 'records');
            open.result.close();
            resolve({ records: all.result as StoredRecord[], binary });
          };
        };
      }),
  );
}
