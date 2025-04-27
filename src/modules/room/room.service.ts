import { Injectable } from '@nestjs/common';
import { Participant, Prisma } from '@prisma/client';
import { PrismaService } from 'prisma/prisma.service';
import { ParticipantService } from './participant.service';

@Injectable()
export class RoomService {
  constructor(
    private readonly prismaService: PrismaService,
    private readonly participantService: ParticipantService,
  ) {}

  async findUnique(args: Prisma.RoomFindUniqueArgs) {
    return this.prismaService.room.findUnique(args);
  }

  async create(args: Prisma.RoomCreateArgs) {
    return this.prismaService.room.create(args);
  }

  async upsert(args: Prisma.RoomUpsertArgs) {
    return this.prismaService.room.upsert(args);
  }

  async update(args: Prisma.RoomUpdateArgs) {
    return this.prismaService.room.update(args);
  }

  async addParticipant(
    code: string,
    userId: string,
  ): Promise<Participant | undefined> {
    const room = await this.findUnique({
      where: {
        code,
        isActive: true,
      },
    });

    if (!room) {
      return;
    }

    return this.participantService.upsert({
      where: {
        roomId_userId: {
          roomId: room.id,
          userId: userId,
        },
      },
      create: {
        roomId: room.id,
        userId,
        isActive: false,
      },
      update: {
        isActive: false,
      },
    });
  }
}
