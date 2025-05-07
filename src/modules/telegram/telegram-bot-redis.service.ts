import { Injectable, Logger } from '@nestjs/common';
import { RedisService } from '../redis/redis.service';
import { BotUserStatusE } from 'src/utils/types';
import { Participant, Room } from '@prisma/client';
import { ParticipantService } from '../room/participant.service';

@Injectable()
export class TelegramBotRedisService {
  private logger: Logger = new Logger(TelegramBotRedisService.name);
  private readonly userStatusPrefix = 'user-status:';
  private readonly participantPrefix = 'participant-data:';
  private readonly roomActiveUsersPrefix = 'room-active-users:';

  constructor(
    private readonly redisService: RedisService,
    private readonly participantService: ParticipantService,
  ) {}

  async getUserStatus(
    userId: string,
    roomId: string,
  ): Promise<BotUserStatusE | null> {
    const status = await this.redisService
      .getClient()
      .get(`${this.userStatusPrefix}${roomId}:${userId}`);

    if (status) {
      return status as BotUserStatusE;
    }

    const participant = await this.participantService.findUnique({
      where: {
        roomId_userId: {
          roomId,
          userId,
        },
      },
    });

    if (!participant) {
      return null;
    }

    if (participant.isActive && participant.username) {
      return await this.upsertUserStatus(
        userId,
        roomId,
        BotUserStatusE.PARTICIPANT,
      );
    } else if (!participant.isActive && participant.username) {
      return await this.upsertUserStatus(userId, roomId, BotUserStatusE.FREE);
    } else {
      return await this.upsertUserStatus(
        userId,
        roomId,
        BotUserStatusE.INPUT_USERNAME,
      );
    }
  }

  async upsertUserStatus(
    userId: string,
    roomId: string,
    status: BotUserStatusE,
  ): Promise<BotUserStatusE> {
    await this.redisService
      .getClient()
      .set(`${this.userStatusPrefix}${roomId}:${userId}`, `${status}`);
    return status;
  }

  async addUserToRoom(
    userId: string,
    roomId: string,
    participant: Participant,
  ) {
    const client = this.redisService.getClient();
    await client.sadd(`${this.roomActiveUsersPrefix}${roomId}`, userId);
    await client.set(
      `${this.participantPrefix}${roomId}:${userId}`,
      this.redisService.serialize(participant),
    );
  }

  async removeUserFromRoom(userId: string, roomId: string) {
    const client = this.redisService.getClient();
    await client.srem(`${this.roomActiveUsersPrefix}${roomId}`, userId);
    await client.del(`${this.participantPrefix}${roomId}:${userId}`);
  }

  async isUserActiveInRoom(userId: string, roomId: string) {
    const isMember = await this.redisService
      .getClient()
      .sismember(`${this.roomActiveUsersPrefix}${roomId}`, userId);
    return isMember === 1;
  }

  async getParticipant(roomId: string, userId: string) {
    const client = this.redisService.getClient();
    const particapantString = await client.get(
      `${this.participantPrefix}${roomId}-${userId}`,
    );

    if (!particapantString) {
      const participant = await this.participantService.findUnique({
        where: {
          roomId_userId: {
            roomId,
            userId,
          },
        },
      });

      if (!participant || !participant.isActive) {
        return null;
      }

      const isActive = this.isUserActiveInRoom(userId, roomId);

      if (!isActive) {
        await this.addUserToRoom(userId, roomId, participant);
      } else {
        await client.set(
          `${this.participantPrefix}${roomId}:${userId}`,
          this.redisService.serialize(participant),
        );
      }

      return participant;
    }

    return this.redisService.deserialize<Participant>(particapantString);
  }

  async getActiveUserIdsInRoom(roomId: string) {
    const client = this.redisService.getClient();

    const userIds = await client.smembers(
      `${this.roomActiveUsersPrefix}${roomId}`,
    );

    return userIds;
  }

  async getActiveUsersInRoom(roomId: string) {
    const client = this.redisService.getClient();

    const userIds = await client.smembers(
      `${this.roomActiveUsersPrefix}${roomId}`,
    );

    if (userIds.length === 0) return [];

    const pipeline = client.multi();

    userIds.forEach((userId) => {
      pipeline.get(`${this.participantPrefix}${roomId}:${userId}`);
    });

    const participants = await pipeline.exec();

    return participants.map<Participant>((item) =>
      this.redisService.deserialize(item[1] as string),
    );
  }
}
