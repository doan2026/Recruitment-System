import { HttpException, HttpStatus } from '@nestjs/common';

export class ApiException extends HttpException {
  constructor(
    code: string,
    message: string,
    status: HttpStatus,
    details: unknown = null,
  ) {
    super({ code, message, details }, status);
  }
}
