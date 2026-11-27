import { afterEach, describe, expect, it } from 'vitest';
import { WEB_ORIGIN, closeAll, heartBody, startHarness, TOKEN, KEY } from './http-test-support';

afterEach(closeAll);

const preflight = (base: Awaited<ReturnType<typeof startHarness>>, origin: string) =>
  base.request('/jobs', {
    method: 'OPTIONS',
    headers: {
      Origin: origin,
      'Access-Control-Request-Method': 'POST',
      'Access-Control-Request-Headers': 'x-session-token,idempotency-key',
    },
  });

describe('CORS', () => {
  it('allows only WEB_ORIGIN on preflight, with X-Session-Token and no credentials', async () => {
    const h = await startHarness();
    const res = await preflight(h, WEB_ORIGIN);
    expect(res.status).toBe(204);
    expect(res.headers.get('access-control-allow-origin')).toBe(WEB_ORIGIN);
    expect(res.headers.get('access-control-allow-headers')).toContain('X-Session-Token');
    expect(res.headers.get('access-control-allow-headers')).toContain('Idempotency-Key');
    expect(res.headers.get('access-control-allow-credentials')).toBeNull();
    expect(res.headers.get('vary')).toContain('Origin');
    expect(res.headers.get('cache-control')).toBe('private, no-store');
  });

  it('sends no allow headers to another origin, but still varies on Origin', async () => {
    const h = await startHarness();
    for (const origin of ['https://evil.example.test', `${WEB_ORIGIN}.evil.test`, WEB_ORIGIN.toUpperCase()]) {
      const res = await preflight(h, origin);
      expect(res.status).toBe(204);
      expect(res.headers.get('access-control-allow-origin')).toBeNull();
      expect(res.headers.get('access-control-allow-headers')).toBeNull();
      expect(res.headers.get('access-control-allow-credentials')).toBeNull();
      expect(res.headers.get('vary')).toContain('Origin');
    }
  });

  it('adds allow-origin to real responses only for WEB_ORIGIN, and never credentials', async () => {
    const h = await startHarness();
    const ok = await h.request('/health', { headers: { Origin: WEB_ORIGIN } });
    expect(ok.headers.get('access-control-allow-origin')).toBe(WEB_ORIGIN);
    expect(ok.headers.get('access-control-allow-credentials')).toBeNull();
    const other = await h.request('/health', { headers: { Origin: 'https://evil.example.test' } });
    expect(other.headers.get('access-control-allow-origin')).toBeNull();
    expect(other.headers.get('vary')).toContain('Origin');
    const created = await h.request('/jobs', {
      method: 'POST',
      headers: { Origin: WEB_ORIGIN, 'X-Session-Token': TOKEN, 'Idempotency-Key': KEY },
      body: JSON.stringify(heartBody),
    });
    expect(created.headers.get('access-control-allow-credentials')).toBeNull();
    expect(h.runs()).toBeLessThanOrEqual(1);
  });
});
