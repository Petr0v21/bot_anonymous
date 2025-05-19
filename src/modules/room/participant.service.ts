import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from 'prisma/prisma.service';

@Injectable()
export class ParticipantService {
  constructor(private readonly prismaService: PrismaService) {}

  async find(args: Prisma.ParticipantFindManyArgs) {
    return this.prismaService.participant.findMany(args);
  }

  async findOne(args: Prisma.ParticipantFindFirstArgs) {
    return this.prismaService.participant.findFirst(args);
  }

  async findUnique(args: Prisma.ParticipantFindUniqueArgs) {
    return this.prismaService.participant.findUnique(args);
  }

  async upsert(args: Prisma.ParticipantUpsertArgs) {
    return this.prismaService.participant.upsert(args);
  }

  async update(args: Prisma.ParticipantUpdateArgs) {
    return this.prismaService.participant.update(args);
  }

  async removeParticipant(roomId: string, userId: string) {
    return this.prismaService.participant.delete({
      where: {
        roomId_userId: {
          roomId,
          userId,
        },
        isActive: false,
      },
    });
  }
}
