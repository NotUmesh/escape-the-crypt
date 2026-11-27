const FORBIDDEN = /[\s'"`;*\\<>]/;
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1"]);

/** Returns a normalised bare origin, or null when the value is not an accepted worker origin. */
export function parseWorkerOrigin(raw: string | undefined): string | null {
  if (raw === undefined || raw === "" || FORBIDDEN.test(raw)) return null;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.username !== "" || url.password !== "") return null;
  if (url.search !== "" || url.hash !== "" || raw.includes("?") || raw.includes("#")) return null;
  if (url.pathname !== "/") return null;
  const secure = url.protocol === "https:";
  const localHttp = url.protocol === "http:" && LOCAL_HOSTS.has(url.hostname);
  if (!secure && !localHttp) return null;
  if (url.hostname === "") return null;
  return url.origin;
}

let cached: { value: string | null } | undefined;

/** The configured worker origin, read once from `VITE_WORKER_URL`. */
export function workerOrigin(): string | null {
  cached ??= { value: parseWorkerOrigin(import.meta.env.VITE_WORKER_URL) };
  return cached.value;
}
