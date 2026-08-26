import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Request, Response } from 'express';

interface ExceptionResponse {
  code?: string;
  message?: string | string[];
  details?: unknown;
}

const STATUS_CODES: Partial<Record<HttpStatus, string>> = {
  [HttpStatus.BAD_REQUEST]: 'BAD_REQUEST',
  [HttpStatus.UNAUTHORIZED]: 'UNAUTHORIZED',
  [HttpStatus.FORBIDDEN]: 'FORBIDDEN',
  [HttpStatus.NOT_FOUND]: 'NOT_FOUND',
  [HttpStatus.CONFLICT]: 'CONFLICT',
  [HttpStatus.SERVICE_UNAVAILABLE]: 'SERVICE_UNAVAILABLE',
};

@Catch()
export class ApiExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(ApiExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const context = host.switchToHttp();
    const response = context.getResponse<Response>();
    const request = context.getRequest<Request>();

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let code = 'INTERNAL_SERVER_ERROR';
    let message = 'An unexpected error occurred';
    let details: unknown = null;

    if (exception instanceof HttpException) {
      status = exception.getStatus();
      const value = exception.getResponse();
      if (typeof value === 'string') {
        message = value;
      } else {
        const payload = value as ExceptionResponse;
        code = payload.code ?? STATUS_CODES[status] ?? 'HTTP_ERROR';
        if (Array.isArray(payload.message)) {
          code = 'VALIDATION_ERROR';
          message = 'Request validation failed';
          details = { errors: payload.message };
        } else {
          message = payload.message ?? exception.message;
          details = payload.details ?? null;
        }
      }
    } else {
      this.logger.error(
        JSON.stringify({
          method: request.method,
          path: request.originalUrl,
          error:
            exception instanceof Error
              ? { name: exception.name, message: exception.message }
              : String(exception),
        }),
        exception instanceof Error ? exception.stack : undefined,
      );
    }

    response.setHeader('Cache-Control', 'private, no-store');
    response.status(status).json({ code, message, details });
  }
}
