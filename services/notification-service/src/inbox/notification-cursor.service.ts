import { HttpStatus, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NotificationType } from '@prisma/client';
import { createHmac, timingSafeEqual } from 'crypto';
import { ApiException } from '../common/api-exception';
import { isCanonicalUuid } from '../auth/jwt-verifier.service';

export interface NotificationCursor {
  createdAt: Date;
  id: string;
}

interface CursorPayload {
  v: 1;
  u: string;
  t: NotificationType | null;
  c: string;
  i: string;
}

@Injectable()
export class NotificationCursorService {
  private readonly key: Buffer;

  constructor(config: ConfigService) {
    this.key = Buffer.from(
      config.getOrThrow<string>('NOTIFICATION_CURSOR_HMAC_KEY'),
      'utf8',
    );
  }

  encode(
    userId: string,
    type: NotificationType | undefined,
    cursor: NotificationCursor,
  ): string {
    const body = Buffer.from(
      JSON.stringify({
        v: 1,
        u: userId,
        t: type ?? null,
        c: cursor.createdAt.toISOString(),
        i: cursor.id,
      } satisfies CursorPayload),
      'utf8',
    ).toString('base64url');
    return `${body}.${this.sign(body)}`;
  }

  decode(
    encoded: string | undefined,
    userId: string,
    type: NotificationType | undefined,
  ): NotificationCursor | null {
    if (!encoded) return null;
    if (encoded.length > 1024) throw invalidCursor();
    const parts = encoded.split('.');
    if (parts.length !== 2 || !parts[0] || !parts[1]) throw invalidCursor();
    const expected = Buffer.from(this.sign(parts[0]), 'base64url');
    let actual: Buffer;
    try {
      actual = Buffer.from(parts[1], 'base64url');
    } catch {
      throw invalidCursor();
    }
    if (
      actual.length !== expected.length ||
      !timingSafeEqual(actual, expected)
    ) {
      throw invalidCursor();
    }
    let payload: unknown;
    try {
      payload = JSON.parse(
        Buffer.from(parts[0], 'base64url').toString('utf8'),
      ) as unknown;
    } catch {
      throw invalidCursor();
    }
    if (!isCursorPayload(payload)) throw invalidCursor();
    if (payload.u !== userId || payload.t !== (type ?? null)) {
      throw new ApiException(
        'NOTIFICATION_CURSOR_SCOPE_MISMATCH',
        'Notification cursor does not match this user or filter',
        HttpStatus.BAD_REQUEST,
      );
    }
    const createdAt = new Date(payload.c);
    if (Number.isNaN(createdAt.valueOf())) throw invalidCursor();
    return { createdAt, id: payload.i };
  }

  private sign(value: string): string {
    return createHmac('sha256', this.key)
      .update(value, 'utf8')
      .digest('base64url');
  }
}

const isCursorPayload = (value: unknown): value is CursorPayload => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }
  const record = value as Record<string, unknown>;
  if (
    Object.keys(record).length !== 5 ||
    record.v !== 1 ||
    typeof record.u !== 'string' ||
    !isCanonicalUuid(record.u) ||
    typeof record.c !== 'string' ||
    typeof record.i !== 'string' ||
    !isCanonicalUuid(record.i)
  ) {
    return false;
  }
  return (
    record.t === null ||
    (typeof record.t === 'string' &&
      Object.values(NotificationType).includes(
        record.t as NotificationType,
      ))
  );
};

const invalidCursor = (): ApiException =>
  new ApiException(
    'NOTIFICATION_CURSOR_INVALID',
    'Notification cursor is invalid or has been tampered with',
    HttpStatus.BAD_REQUEST,
  );
