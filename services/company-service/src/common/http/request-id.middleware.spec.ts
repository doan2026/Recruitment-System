import { Logger } from '@nestjs/common';
import { NextFunction, Request, Response } from 'express';
import { RequestIdMiddleware } from './request-id.middleware';

describe('RequestIdMiddleware', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('logs only the path and never a public search query or cursor', () => {
    const log = jest.spyOn(Logger.prototype, 'log').mockImplementation();
    let finish: (() => void) | undefined;
    const request = {
      method: 'GET',
      path: '/search',
      originalUrl: '/search?q=private-text&cursor=signed-secret',
      header: jest.fn().mockReturnValue('request-123'),
    } as unknown as Request;
    const response = {
      statusCode: 200,
      setHeader: jest.fn(),
      on: jest.fn((event: string, callback: () => void) => {
        if (event === 'finish') finish = callback;
        return response;
      }),
    } as unknown as Response;
    const next = jest.fn() as NextFunction;

    new RequestIdMiddleware().use(request, response, next);
    finish?.();

    expect(next).toHaveBeenCalledTimes(1);
    expect(response.setHeader).toHaveBeenCalledWith(
      'x-request-id',
      'request-123',
    );
    expect(log).toHaveBeenCalledTimes(1);
    const event = JSON.parse(String(log.mock.calls[0][0])) as {
      path: string;
    };
    expect(event.path).toBe('/search');
    expect(log.mock.calls[0][0]).not.toContain('private-text');
    expect(log.mock.calls[0][0]).not.toContain('signed-secret');
  });
});
