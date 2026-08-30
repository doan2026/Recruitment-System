import {
  CanActivate,
  Controller,
  ExecutionContext,
  Get,
  HttpStatus,
  Header,
  Injectable,
  NestMiddleware,
  UseGuards,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { timingSafeEqual } from 'node:crypto';
import { ApiException } from './common';

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
  '/health',
  '/metrics',
  '/search',
  '/recommended',
  '/stats/active',
  '/details/bulk',
]);
const OTHER_ROUTE = 'other';

export const normalizeRoute = (path: string): string => {
  if (KNOWN_ROUTES.has(path)) return path;
  // A job path carries an identifier, so it is templated rather than dropped:
  // /{id} and /{id}/exists stay useful without ever labelling by job id.
  if (/^\/[0-9a-f-]{36}\/exists$/i.test(path)) return '/{id}/exists';
  if (/^\/[0-9a-f-]{36}$/i.test(path)) return '/{id}';
  return OTHER_ROUTE;
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
      '# HELP job_http_requests_total Requests by route and status class.',
      '# TYPE job_http_requests_total counter',
    ];
    for (const key of [...this.requests.keys()].sort()) {
      const [route, outcome] = key.split('|');
      lines.push(
        `job_http_requests_total{route="${route}",status="${outcome}"} ` +
          `${this.requests.get(key)}`,
      );
    }
    lines.push(
      '# HELP job_http_request_duration_seconds Request latency by route.',
      '# TYPE job_http_request_duration_seconds histogram',
    );
    for (const route of [...this.buckets.keys()].sort()) {
      const counts = this.buckets.get(route) as number[];
      LATENCY_BUCKETS.forEach((bucket, index) => {
        lines.push(
          'job_http_request_duration_seconds_bucket' +
            `{route="${route}",le="${bucket}"} ${counts[index]}`,
        );
      });
      const total = this.durationCount.get(route) ?? 0;
      lines.push(
        'job_http_request_duration_seconds_bucket' +
          `{route="${route}",le="+Inf"} ${total}`,
        'job_http_request_duration_seconds_sum' +
          `{route="${route}"} ${(this.durationSum.get(route) ?? 0).toFixed(6)}`,
        'job_http_request_duration_seconds_count' +
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
    // to read Job availability has no business reading the request rates and
    // latency distribution of the whole deployment.
    const expected = this.config.get<string>('INTERNAL_API_KEY_METRICS');
    if (!expected || expected.trim().length < 32) {
      throw new Error(
        'INTERNAL_API_KEY_METRICS must be a key of at least 32 bytes',
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

@Controller('metrics')
export class MetricsController {
  constructor(private readonly registry: MetricsRegistry) {}

  @Get()
  @UseGuards(MetricsGuard)
  @Header('Content-Type', 'text/plain; version=0.0.4; charset=utf-8')
  @Header('Cache-Control', 'no-store')
  scrape(): string {
    return this.registry.render();
  }
}
