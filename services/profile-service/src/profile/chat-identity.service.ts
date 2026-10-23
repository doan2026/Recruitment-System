import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { ChatIdentityDto } from './dto/chat-identity.dto';

@Injectable()
export class ChatIdentityService {
  constructor(private readonly prisma: PrismaService) {}

  async resolve(userIds: string[]): Promise<ChatIdentityDto[]> {
    const profiles = await this.prisma.profile.findMany({
      where: { userId: { in: userIds } },
      select: { userId: true, fullName: true, avatarUrl: true },
    });
    return profiles.map(profile => ({ userId: profile.userId, name: profile.fullName ?? '', avatarUrl: profile.avatarUrl }));
  }
}
