import { describe, expect, it } from 'vitest';
import { routeFor } from './routes';

describe('routeFor', () => {
  it('finds the ingest screen at the root', () => {
    expect(routeFor('/ingest', '/')).toBe('ingest');
    expect(routeFor('/ingest/', '/')).toBe('ingest');
  });
  it('finds it under a subpath base', () => {
    expect(routeFor('/crypt/ingest', '/crypt/')).toBe('ingest');
    expect(routeFor('/crypt/ingest', '/crypt')).toBe('ingest');
  });
  it('shows home everywhere else', () => {
    expect(routeFor('/', '/')).toBe('home');
    expect(routeFor('/crypt/', '/crypt/')).toBe('home');
    expect(routeFor('/other', '/')).toBe('home');
    expect(routeFor('/ingest/more', '/')).toBe('home');
  });
});