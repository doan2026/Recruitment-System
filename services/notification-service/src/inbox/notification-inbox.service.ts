import { HttpStatus, Injectable } from '@nestjs/common';
import { NotificationType, Prisma } from '@prisma/client';
import { ApiException } from '../common/api-exception';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationCursorService } from './notification-cursor.service';

export interface NotificationItem {
  id: string;
  type: NotificationType;
  title: string;
  body: string;
  payload: Prisma.JsonValue;
  readAt: string | null;
  createdAt: string;
}

@Injectable()
export class NotificationInboxService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cursors: NotificationCursorService,
  ) {}

  async list(
    userId: string,
    type: NotificationType | undefined,
    cursorValue: string | undefined,
    limit: number,
  ): Promise<{
    items: NotificationItem[];
    nextCursor: string | null;
  }> {
    const cursor = this.cursors.decode(cursorValue, userId, type);
    const where: Prisma.NotificationWhereInput = {
      userId,
      ...(type ? { type } : {}),
      ...(cursor
        ? {
            OR: [
              { createdAt: { lt: cursor.createdAt } },
              {
                createdAt: cursor.createdAt,
                id: { lt: cursor.id },
              },
            ],
          }
        : {}),
    };
    const rows = await this.prisma.notification.findMany({
      where,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
    });
    const hasNext = rows.length > limit;
    const page = hasNext ? rows.slice(0, limit) : rows;
    const last = page.at(-1);
    return {
      items: page.map((row) => ({
        id: row.id,
        type: row.type,
        title: row.title,
        body: row.body,
        payload: row.payloadJson,
        readAt: row.readAt?.toISOString() ?? null,
        createdAt: row.createdAt.toISOString(),
      })),
      nextCursor:
        hasNext && last
          ? this.cursors.encode(userId, type, {
              createdAt: last.createdAt,
              id: last.id,
            })
          : null,
    };
  }

  async unreadCount(userId: string): Promise<number> {
    return this.prisma.notification.count({
      where: { userId, readAt: null },
    });
  }

  async markRead(userId: string, id: string): Promise<NotificationItem> {
    await this.prisma.notification.updateMany({
      where: { id, userId, readAt: null },
      data: { readAt: new Date() },
    });
    const row = await this.prisma.notification.findFirst({
      where: { id, userId },
    });
    if (!row) throw notificationNotFound();
    return {
      id: row.id,
      type: row.type,
      title: row.title,
      body: row.body,
      payload: row.payloadJson,
      readAt: row.readAt?.toISOString() ?? null,
      createdAt: row.createdAt.toISOString(),
    };
  }

  async markAllRead(
    userId: string,
  ): Promise<{ updatedCount: number; cutoff: string }> {
    return this.prisma.$transaction(async (transaction) => {
      const [clock] = await transaction.$queryRaw<Array<{ now: Date }>>(
        Prisma.sql`SELECT clock_timestamp() AS now`,
      );
      const cutoff = clock.now;
      const result = await transaction.notification.updateMany({
        where: {
          userId,
          readAt: null,
          createdAt: { lte: cutoff },
        },
        data: { readAt: cutoff },
      });
      return {
        updatedCount: result.count,
        cutoff: cutoff.toISOString(),
      };
    });
  }
}

const notificationNotFound = (): ApiException =>
  new ApiException(
    'NOTIFICATION_NOT_FOUND',
    'Notification was not found',
    HttpStatus.NOT_FOUND,
  );
