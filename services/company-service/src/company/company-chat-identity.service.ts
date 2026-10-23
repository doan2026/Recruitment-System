import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CompanyChatIdentityDto } from './dto/chat-identity.dto';

@Injectable()
export class CompanyChatIdentityService {
  constructor(private readonly prisma: PrismaService) {}

  async resolve(userIds: string[]): Promise<CompanyChatIdentityDto[]> {
    const memberships = await this.prisma.companyMember.findMany({
      where: { userId: { in: userIds } },
      select: { userId: true, company: { select: { id: true, name: true, logoUrl: true } } },
    });
    return memberships.map(member => ({ userId: member.userId, companyId: member.company.id, name: member.company.name, avatarUrl: member.company.logoUrl }));
  }
}
