import {
  CanActivate,
  Controller,
  ExecutionContext,
  Get,
  HttpStatus,
  Injectable,
  NestMiddleware,
  Res,
  UseGuards,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { timingSafeEqual } from 'node:crypto';
import { ApiException } from './common/errors/api-exception';
import { Public } from './common/auth/public.decorator';

/** The narrow slice of the HTTP objects this module needs. */
interface MetricsRequest {
  readonly path: string;
}

interface MetricsResponse {
  readonly statusCode: number;
  on(event: 'finish', listener: () => void): unknown;
}

/**
 * Latency buckets in seconds. The tail matters here: a search or a
 * recommendation scan is far slower than a health probe.
 */
const LATENCY_BUCKETS = [
  0.005, 0.025, 0.05, 0.1, 0.25, 0.5, 1.0, 2.5, 5.0, 10.0,
] as const;

/**
 * Every route worth an SLO. Anything else folds into `other`, so a scanner
 * walking random paths cannot grow the registry without limit.
 */
const KNOWN_ROUTES = new Set([
  // The gateway maps POST /companies/ (create) and GET /companies/ (admin
  // queue) to the service root.
  '/',
  '/health',
  '/metrics',
  '/search',
  '/me',
  '/me/submit-verification',
  '/invitations/accept',
]);
const OTHER_ROUTE = 'other';

export const normalizeRoute = (path: string): string => {
  if (KNOWN_ROUTES.has(path)) return path;
  // A company path carries an identifier, so it is templated rather than
  // dropped: the shape stays useful without ever labelling by company id.
  const templated = path.replace(
    /\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi,
    '/{id}',
  );
  const KNOWN_TEMPLATES = new Set([
    '/{id}',
    '/{id}/members',
    '/{id}/media/signature',
    '/{id}/media/confirm',
    '/{id}/verify',
    '/by-user/{id}',
    '/internal/{id}',
    '/{id}/members/{id}',
    '/{id}/members/{id}/transfer-ownership',
  ]);
  return KNOWN_TEMPLATES.has(templated) ? templated : OTHER_ROUTE;
};

export const statusClass = (status: number): string => {
  if (status >= 200 && status < 300) return '2xx';
  if (status >= 400 && status < 500) return '4xx';
  if (status >= 500 && status < 600) return '5xx';
  return OTHER_ROUTE;
};

@Injectable()
export class MetricsRegistry {
  private readonly requests = new Map<string, number>();
  private readonly buckets = new Map<string, number[]>();
  private readonly durationSum = new Map<string, number>();
  private readonly durationCount = new Map<string, number>();

  observe(path: string, status: number, durationSeconds: number): void {
    const route = normalizeRoute(path);
    const outcome = statusClass(status);
    const duration = Math.max(0, durationSeconds);
    const key = `${route}|${outcome}`;
    this.requests.set(key, (this.requests.get(key) ?? 0) + 1);
    const counts =
      this.buckets.get(route) ?? LATENCY_BUCKETS.map(() => 0);
    LATENCY_BUCKETS.forEach((bucket, index) => {
      if (duration <= bucket) counts[index] += 1;
    });
    this.buckets.set(route, counts);
    this.durationSum.set(route, (this.durationSum.get(route) ?? 0) + duration);
    this.durationCount.set(route, (this.durationCount.get(route) ?? 0) + 1);
  }

  render(): string {
    const lines: string[] = [
      '# HELP company_http_requests_total Requests by route and status class.',
      '# TYPE company_http_requests_total counter',
    ];
    for (const key of [...this.requests.keys()].sort()) {
      const [route, outcome] = key.split('|');
      lines.push(
        `company_http_requests_total{route="${route}",status="${outcome}"} ` +
          `${this.requests.get(key)}`,
      );
    }
    lines.push(
      '# HELP company_http_request_duration_seconds Request latency by route.',
      '# TYPE company_http_request_duration_seconds histogram',
    );
    for (const route of [...this.buckets.keys()].sort()) {
      const counts = this.buckets.get(route) as number[];
      LATENCY_BUCKETS.forEach((bucket, index) => {
        lines.push(
          'company_http_request_duration_seconds_bucket' +
            `{route="${route}",le="${bucket}"} ${counts[index]}`,
        );
      });
      const total = this.durationCount.get(route) ?? 0;
      lines.push(
        'company_http_request_duration_seconds_bucket' +
          `{route="${route}",le="+Inf"} ${total}`,
        'company_http_request_duration_seconds_sum' +
          `{route="${route}"} ${(this.durationSum.get(route) ?? 0).toFixed(6)}`,
        'company_http_request_duration_seconds_count' +
          `{route="${route}"} ${total}`,
      );
    }
    return lines.join('\n') + '\n';
  }
}

@Injectable()
export class MetricsMiddleware implements NestMiddleware {
  constructor(private readonly registry: MetricsRegistry) {}

  use(
    request: MetricsRequest,
    response: MetricsResponse,
    next: () => void,
  ): void {
    const started = process.hrtime.bigint();
    response.on('finish', () => {
      const elapsed = Number(process.hrtime.bigint() - started) / 1e9;
      this.registry.observe(request.path, response.statusCode, elapsed);
    });
    next();
  }
}

@Injectable()
export class MetricsGuard implements CanActivate {
  constructor(private readonly config: ConfigService) {}

  canActivate(context: ExecutionContext): boolean {
    // A scrape carries no user, so this checks a key rather than a token. The
    // key is distinct from INTERNAL_API_KEY on purpose: a service authorised
    // to read Company data has no business reading the request rates and
    // latency distribution of the whole deployment.
    const expected = this.config.get<string>('INTERNAL_API_KEY_METRICS');
    // The placeholder check matters as much as the length one: the value
    // shipped in .env.example is long enough to pass a bare length test, so
    // without this a deployment that never replaced it would accept a
    // credential published in the repository.
    if (
      !expected ||
      expected !== expected.trim() ||
      expected.length < 32 ||
      expected.toLowerCase().includes('replace-with')
    ) {
      throw new Error(
        'INTERNAL_API_KEY_METRICS must be a non-placeholder key of at ' +
          'least 32 bytes',
      );
    }
    const header = context.switchToHttp().getRequest()
      .headers['x-internal-api-key'];
    if (Array.isArray(header) || typeof header !== 'string') {
      throw this.unauthorized();
    }
    const provided = Buffer.from(header, 'utf8');
    const target = Buffer.from(expected, 'utf8');
    if (
      provided.length !== target.length ||
      !timingSafeEqual(provided, target)
    ) {
      throw this.unauthorized();
    }
    return true;
  }

  private unauthorized(): ApiException {
    return new ApiException(
      'INVALID_INTERNAL_API_KEY',
      'A valid internal API key is required',
      HttpStatus.UNAUTHORIZED,
    );
  }
}

/** The narrow slice of the response object the scrape needs. */
interface ScrapeResponse {
  set(field: string, value: string): unknown;
  status(code: number): unknown;
  send(body: string): unknown;
}

@Controller('metrics')
export class MetricsController {
  constructor(private readonly registry: MetricsRegistry) {}

  // `@Public()` only tells the global JWT guard to step aside: a scrape carries
  // no user token. MetricsGuard below still requires the scoped key, so the
  // endpoint is not public in any meaningful sense.
  @Public()
  @Get()
  @UseGuards(MetricsGuard)
  scrape(@Res() response: ScrapeResponse): void {
    // Written straight to the response: the global ApiResponseInterceptor
    // wraps any returned value in a {data, meta} envelope, which is not valid
    // Prometheus exposition and no scraper would parse it.
    response.set('Content-Type', 'text/plain; version=0.0.4; charset=utf-8');
    response.set('Cache-Control', 'no-store');
    response.status(200);
    response.send(this.registry.render());
  }
}
