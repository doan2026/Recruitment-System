import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Observable, map } from 'rxjs';

export interface ApiSuccessResponse<T> {
  data: T;
  meta: Record<string, unknown> | null;
}

export const apiSuccess = <T>(
  data: T,
  meta: Record<string, unknown> | null = null,
): ApiSuccessResponse<T> => ({ data, meta });

const isApiSuccessResponse = <T>(
  value: unknown,
): value is ApiSuccessResponse<T> =>
  typeof value === 'object' &&
  value !== null &&
  Object.prototype.hasOwnProperty.call(value, 'data') &&
  Object.prototype.hasOwnProperty.call(value, 'meta');

@Injectable()
export class ApiResponseInterceptor<T>
  implements NestInterceptor<T | ApiSuccessResponse<T>, ApiSuccessResponse<T>>
{
  intercept(
    _context: ExecutionContext,
    next: CallHandler<T | ApiSuccessResponse<T>>,
  ): Observable<ApiSuccessResponse<T>> {
    return next.handle().pipe(
      map((response) =>
        isApiSuccessResponse<T>(response)
          ? response
          : apiSuccess(response as T),
      ),
    );
  }
}
