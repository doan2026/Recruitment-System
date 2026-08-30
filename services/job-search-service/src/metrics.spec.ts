import { ExecutionContext, HttpStatus } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  MetricsGuard,
  MetricsRegistry,
  normalizeRoute,
  statusClass,
} from './metrics';

const context = (headers: Record<string, unknown>): ExecutionContext =>
  ({
    switchToHttp: () => ({ getRequest: () => ({ headers }) }),
  }) as unknown as ExecutionContext;

const config = (value: string | undefined): ConfigService =>
  ({ get: () => value }) as unknown as ConfigService;

const KEY = 'job-search-metrics-scrape-key-0000001';

describe('route normalisation', () => {
  it('keeps a known route as its own label', () => {
    expect(normalizeRoute('/search')).toBe('/search');
    expect(normalizeRoute('/stats/active')).toBe('/stats/active');
  });

  it('templates a job path so no job id reaches a label', () => {
    const jobId = '20000000-0000-4000-8000-000000000001';

    expect(normalizeRoute(`/${jobId}`)).toBe('/{id}');
    expect(normalizeRoute(`/${jobId}/exists`)).toBe('/{id}/exists');
  });

  it('collapses anything else so scanning cannot grow the registry', () => {
    expect(normalizeRoute('/wp-admin')).toBe('other');
    expect(normalizeRoute('/search/../../etc/passwd')).toBe('other');
  });
});

describe('status classes', () => {
  it.each([
    [200, '2xx'],
    [201, '2xx'],
    [401, '4xx'],
    [429, '4xx'],
    [503, '5xx'],
  ])('collapses %s to %s', (code, expected) => {
    expect(statusClass(code as number)).toBe(expected);
  });
});

describe('registry', () => {
  it('separates success from failure on one route', () => {
    const registry = new MetricsRegistry();

    registry.observe('/search', 200, 0.01);
    registry.observe('/search', 200, 0.02);
    registry.observe('/search', 400, 0.001);
    registry.observe('/search', 500, 0.4);

    const rendered = registry.render();
    expect(rendered).toContain('route="/search",status="2xx"} 2');
    expect(rendered).toContain('route="/search",status="4xx"} 1');
    expect(rendered).toContain('route="/search",status="5xx"} 1');
  });

  it('renders cumulative buckets ending at infinity', () => {
    const registry = new MetricsRegistry();

    registry.observe('/search', 200, 0.01);
    registry.observe('/search', 200, 0.3);
    registry.observe('/search', 200, 20);

    const rendered = registry.render();
    expect(rendered).toContain('le="0.025"} 1');
    expect(rendered).toContain('le="0.5"} 2');
    expect(rendered).toContain('le="+Inf"} 3');
    expect(rendered).toContain(
      'job_http_request_duration_seconds_count{route="/search"} 3',
    );
  });

  it('never lets a job id reach a series', () => {
    const registry = new MetricsRegistry();
    const jobId = '20000000-0000-4000-8000-000000000001';

    registry.observe(`/${jobId}/exists`, 200, 0.01);

    expect(registry.render()).not.toContain(jobId);
  });

  it('adds one series for a scan of many unknown paths', () => {
    const registry = new MetricsRegistry();

    for (let index = 0; index < 300; index += 1) {
      registry.observe(`/scan-${index}`, 404, 0.001);
    }

    const rendered = registry.render();
    expect(rendered).not.toContain('scan-0');
    expect(rendered.match(/job_http_requests_total\{/g)).toHaveLength(1);
  });

  it('clamps a negative duration rather than corrupting the sum', () => {
    const registry = new MetricsRegistry();

    registry.observe('/search', 200, -5);

    expect(registry.render()).toContain(
      'job_http_request_duration_seconds_sum{route="/search"} 0.000000',
    );
  });
});

describe('metrics guard', () => {
  it('accepts the exact scoped key', () => {
    const guard = new MetricsGuard(config(KEY));

    expect(
      guard.canActivate(context({ 'x-internal-api-key': KEY })),
    ).toBe(true);
  });

  it('rejects a missing or wrong key', () => {
    const guard = new MetricsGuard(config(KEY));

    expect(() => guard.canActivate(context({}))).toThrow();
    expect(() =>
      guard.canActivate(context({ 'x-internal-api-key': 'nope' })),
    ).toThrow();
  });

  it('rejects a duplicated key header', () => {
    const guard = new MetricsGuard(config(KEY));

    // Two headers let a proxy and a caller disagree about the credential.
    expect(() =>
      guard.canActivate(context({ 'x-internal-api-key': [KEY, KEY] })),
    ).toThrow();
  });

  it('refuses to run without a configured key of usable length', () => {
    expect(() =>
      new MetricsGuard(config(undefined)).canActivate(context({})),
    ).toThrow('INTERNAL_API_KEY_METRICS');
    expect(() =>
      new MetricsGuard(config('short')).canActivate(context({})),
    ).toThrow('INTERNAL_API_KEY_METRICS');
  });

  it('answers unauthorised rather than leaking the expected key', () => {
    const guard = new MetricsGuard(config(KEY));

    try {
      guard.canActivate(context({ 'x-internal-api-key': 'wrong' }));
      fail('expected a rejection');
    } catch (error) {
      const rendered = JSON.stringify(error);
      expect(rendered).not.toContain(KEY);
      expect((error as { getStatus?: () => number }).getStatus?.()).toBe(
        HttpStatus.UNAUTHORIZED,
      );
    }
  });
});
