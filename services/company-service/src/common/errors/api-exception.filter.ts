import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { RequestWithId } from '../http/request-id.middleware';

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
  [HttpStatus.UNPROCESSABLE_ENTITY]: 'UNPROCESSABLE_ENTITY',
  [HttpStatus.SERVICE_UNAVAILABLE]: 'SERVICE_UNAVAILABLE',
};

@Catch()
export class ApiExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(ApiExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const context = host.switchToHttp();
    const response = context.getResponse<Response>();
    const request = context.getRequest<Request>();
    const requestId = (request as RequestWithId).requestId;

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let code = 'INTERNAL_SERVER_ERROR';
    let message = 'An unexpected error occurred';
    let details: unknown = null;

    if (exception instanceof HttpException) {
      status = exception.getStatus();
      const exceptionResponse = exception.getResponse();

      if (typeof exceptionResponse === 'string') {
        message = exceptionResponse;
      } else {
        const payload = exceptionResponse as ExceptionResponse;
        code = payload.code ?? STATUS_CODES[status] ?? 'HTTP_ERROR';

        if (Array.isArray(payload.message)) {
          message = 'Request validation failed';
          details = { errors: payload.message };
          code = 'VALIDATION_ERROR';
        } else {
          message = payload.message ?? exception.message;
          details = payload.details ?? null;
        }
      }
    } else {
      this.logger.error(
        JSON.stringify({
          requestId,
          method: request.method,
          path: request.originalUrl,
          exception:
            exception instanceof Error
              ? { name: exception.name, message: exception.message }
              : String(exception),
        }),
        exception instanceof Error ? exception.stack : undefined,
      );
    }

    response.status(status).json({ code, message, details });
  }
}
