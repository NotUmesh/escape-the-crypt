export type Route = 'home' | 'ingest';

/** Maps a pathname to a screen, relative to Vite's `BASE_URL` so a subpath deploy works. */
export function routeFor(pathname: string, baseUrl: string): Route {
  const base = baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`;
  const rest = pathname.startsWith(base) ? pathname.slice(base.length) : pathname.replace(/^\//, '');
  return rest.replace(/\/+$/, '') === 'ingest' ? 'ingest' : 'home';
}