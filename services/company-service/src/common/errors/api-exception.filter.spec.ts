import { ArgumentsHost, Logger } from '@nestjs/common';
import { Request, Response } from 'express';
import { ApiExceptionFilter } from './api-exception.filter';

describe('ApiExceptionFilter', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('does not log a public search query or cursor for an unexpected error', () => {
    const errorLog = jest
      .spyOn(Logger.prototype, 'error')
      .mockImplementation();
    const request = {
      method: 'GET',
      path: '/search',
      originalUrl: '/search?q=private-text&cursor=signed-secret',
      requestId: 'request-123',
    } as unknown as Request;
    const response = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn(),
    } as unknown as Response;
    const host = {
      switchToHttp: () => ({
        getRequest: () => request,
        getResponse: () => response,
      }),
    } as ArgumentsHost;

    new ApiExceptionFilter().catch(new Error('database unavailable'), host);

    expect(errorLog).toHaveBeenCalledTimes(1);
    const event = String(errorLog.mock.calls[0][0]);
    expect(JSON.parse(event)).toMatchObject({
      requestId: 'request-123',
      method: 'GET',
      path: '/search',
    });
    expect(event).not.toContain('private-text');
    expect(event).not.toContain('signed-secret');
    expect(response.status).toHaveBeenCalledWith(500);
  });
});
