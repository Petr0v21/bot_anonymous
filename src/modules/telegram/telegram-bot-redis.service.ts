import { Injectable, Logger } from '@nestjs/common';
import { RedisService } from '../redis/redis.service';
import { BotUserStatusE, PartlyRoom, UserDataStatusT } from 'src/utils/types';
import { Participant, Room } from '@prisma/client';

@Injectable()
export class TelegramBotRedisService {
  private logger: Logger = new Logger(TelegramBotRedisService.name);
  private readonly userStatusPrefix = 'user-status:';
  private readonly participantPrefix = 'participant-data:';
  private readonly roomActiveUsersPrefix = 'room-active-users:';
  private readonly partlyRoomPrefix = 'pertly-room:';

  constructor(private readonly redisService: RedisService) {}

  async getUserStatus(userId: number | string): Promise<UserDataStatusT> {
    const status = await this.redisService
      .getClient()
      .get(`${this.userStatusPrefix}${userId}`);

    if (!status) {
      return {
        status: null,
      };
    }
    const sepData = status.split(':');
    return {
      status: sepData[0] as BotUserStatusE,
      roomId: sepData[1],
    };
  }

  async upsertUserStatus(
    userId: number | string,
    status: BotUserStatusE,
    roomId?: string,
  ): Promise<void> {
    await this.redisService
      .getClient()
      .set(`${this.userStatusPrefix}${userId}`, `${status}:${roomId}`);
  }

  async addUserToRoom(
    userId: number | string,
    roomId: string,
    participant: Participant,
  ) {
    const client = this.redisService.getClient();
    await client.sadd(`${this.roomActiveUsersPrefix}${roomId}`, userId);
    await client.set(
      `${this.participantPrefix}:${roomId}-${userId}`,
      this.redisService.serialize(participant),
    );
  }

  async removeUserFromRoom(userId: number | string, roomId: string) {
    const client = this.redisService.getClient();

    await client.srem(`${this.roomActiveUsersPrefix}${roomId}`, userId);
    await client.del(`${this.participantPrefix}:${roomId}-${userId}`);
  }

  async getParticipant(roomId: string, userId: string | number) {
    const client = this.redisService.getClient();
    const particapantString = await client.get(
      `${this.participantPrefix}:${roomId}-${userId}`,
    );

    if (!particapantString) {
      return null;
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
      pipeline.get(`${this.participantPrefix}:${roomId}-${userId}`);
    });

    const participants = await pipeline.exec();

    return participants.map<Participant>((item) =>
      this.redisService.deserialize(item[1] as string),
    );
  }

  async isUserActiveInRoom(userId: number | string, roomId: string) {
    const isMember = await this.redisService
      .getClient()
      .sismember(`${this.roomActiveUsersPrefix}${roomId}`, userId);
    return isMember === 1;
  }

  async getPartlyRoom(userId: string | number): Promise<PartlyRoom> {
    const stringObj = await this.redisService
      .getClient()
      .get(`${this.partlyRoomPrefix}:${userId}`);
    return this.redisService.deserialize(stringObj);
  }

  async upsertPartlyRoom(userId: string | number, data: PartlyRoom) {
    return this.redisService
      .getClient()
      .set(
        `${this.partlyRoomPrefix}:${userId}`,
        this.redisService.serialize(data),
      );
  }

  async deletePartlyRoom(userId: string | number) {
    return this.redisService
      .getClient()
      .del(`${this.partlyRoomPrefix}:${userId}`);
  }
}
