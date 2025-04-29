import { Injectable } from '@nestjs/common';
import {
  BotHandlerArgsT,
  BotUserStatusE,
  ContentTypeE,
  MessagePayload,
  PartlyRoom,
  TypeTelegramMessageE,
} from 'src/utils/types';
import { RoomService } from '../room/room.service';
import { ParticipantService } from '../room/participant.service';
import { TelegramBotRedisService } from './telegram-bot-redis.service';
import { RabbitMQService } from '../rabbitmq/rabbitmq.service';
import { ConfigService } from '@nestjs/config';
import { UserService } from '../user/user.service';
import { Context } from 'grammy';

@Injectable()
export class TelegramBotHandlerService {
  constructor(
    private readonly roomService: RoomService,
    private readonly userService: UserService,
    private readonly participantService: ParticipantService,
    private readonly botRedisService: TelegramBotRedisService,
    private readonly rabbitMQService: RabbitMQService,
    private readonly configService: ConfigService,
  ) {}

  private readonly handlers: Record<
    BotUserStatusE,
    (args: BotHandlerArgsT) => Promise<void>
  > = {
    [BotUserStatusE.FREE]: (_args) => this.handleFree(),
    [BotUserStatusE.INPUT_CODE]: (args) => this.handleInputCode(args),
    [BotUserStatusE.INPUT_USERNAME]: (args) => this.handleInputUsername(args),
    [BotUserStatusE.PARTICIPANT]: (args) => this.handleParticipant(args),
    [BotUserStatusE.INPUT_NEW_ADMIN]: (args) => this.handleInputNewAdmin(args),
    [BotUserStatusE.INPUT_NEW_ROOM]: (args) => this.handleInputNewRoom(args),
    [BotUserStatusE.DISACTIVATE_ROOM]: (args) =>
      this.handleDisactivateRoom(args),
  };

  handle(args: BotHandlerArgsT): Promise<void> {
    const handler = this.handlers[args.status.status];
    if (handler) {
      return handler(args);
    } else {
      throw new Error(`No handler implemented for status: ${status}`);
    }
  }

  buildMessagePayloadFromCtx({ message }: Context): MessagePayload {
    const { text, caption } = message;

    if (message.photo) {
      const largestPhoto = message.photo.at(-1); // Берем самое большое фото
      return {
        text: caption,
        fileId: largestPhoto.file_id,
        contentType: ContentTypeE.PHOTO,
      };
    }

    if (message.video_note) {
      return {
        fileId: message.video_note.file_id,
        contentType: ContentTypeE.VIDEO,
      };
    }

    if (message.video) {
      return {
        text: caption,
        fileId: message.video.file_id,
        contentType: ContentTypeE.VIDEO,
      };
    }

    if (message.animation) {
      return {
        text: caption,
        fileId: message.animation.file_id,
        contentType: ContentTypeE.ANIMATION,
      };
    }

    if (message.voice) {
      return {
        text: caption,
        fileId: message.voice.file_id,
        contentType: ContentTypeE.AUDIO,
      };
    }

    if (message.document) {
      return {
        text: caption,
        fileId: message.document.file_id,
        contentType: ContentTypeE.FILE,
      };
    }

    return {
      contentType: ContentTypeE.TEXT,
      text,
    };
  }

  private async handleFree(): Promise<void> {}

  private async handleInputCode({
    userId,
    payload: { text },
    sendMessage,
  }: BotHandlerArgsT): Promise<void> {
    const particapant = await this.roomService.addParticipant(
      text,
      userId.toString(),
    );

    if (!particapant) {
      return sendMessage({
        text: 'Invalid Code',
      });
    }

    await this.botRedisService.upsertUserStatus(
      userId,
      BotUserStatusE.INPUT_USERNAME,
      particapant.roomId,
    );

    sendMessage({
      text: `Input username for room`,
    });
  }

  private async handleInputUsername(args: BotHandlerArgsT): Promise<void> {
    const { roomId } = args.status;
    if (!roomId || roomId === 'undefined') {
      throw new Error('RoomId doesn`t provided!');
    }

    const room = await this.roomService.findUnique({
      where: {
        id: roomId,
      },
    });

    const participant = await this.participantService.upsert({
      where: {
        roomId_userId: {
          roomId,
          userId: args.userId.toString(),
        },
      },
      create: {
        roomId,
        userId: args.userId.toString(),
        isActive: true,
        username: args.payload.text,
      },
      update: {
        isActive: true,
        username: args.payload.text,
      },
    });

    await this.botRedisService.upsertUserStatus(
      args.userId,
      BotUserStatusE.PARTICIPANT,
      roomId,
    );
    await this.botRedisService.addUserToRoom(args.userId, roomId, participant);

    args.sendMessage({
      text: `Welcome ${args.payload.text} to ${room.title}\nDescription: ${room.description}`,
    });
  }

  private async handleParticipant(args: BotHandlerArgsT): Promise<void> {
    const { roomId } = args.status;
    if (!roomId || roomId === 'undefined') {
      throw new Error('RoomId doesn`t provided!');
    }

    const particapant = await this.botRedisService.getParticipant(
      roomId,
      args.userId,
    );

    if (!particapant) {
      throw new Error('Empty participant at redis');
    }

    const users = await this.botRedisService.getActiveUserIdsInRoom(roomId);

    users.forEach((userId) => {
      if (userId === args.userId.toString()) {
        return;
      }

      this.rabbitMQService.tgServiceEmit({
        payload: {
          botToken: this.configService.get('BOT_TOKEN'),
          chatId: userId,
          ...args.payload,
          text: `🥷🏿 ${particapant.username}\n${args.payload.text ?? ''}`,
          type: TypeTelegramMessageE.SINGLE_CHAT,
        },
        messageId: `${args.userId}-fanout-${userId}`,
      });
    });
  }

  private async handleInputNewAdmin(args: BotHandlerArgsT): Promise<void> {
    const user = await this.userService.findUnique({
      where: {
        id: args.payload.text,
      },
    });

    if (!user) {
      return args.sendMessage({
        text: 'This user doesn`t exist at this bot!',
      });
    }

    if (user.isAdmin) {
      return args.sendMessage({
        text: 'This user already admin!',
      });
    }

    await this.userService.update({
      where: {
        id: user.id,
      },
      data: {
        isAdmin: true,
      },
    });

    await this.botRedisService.upsertUserStatus(
      args.userId,
      BotUserStatusE.FREE,
    );

    return args.sendMessage({
      text: `Added new admin ${user.username} with ID ${user.id}`,
    });
  }

  private async handleInputNewRoom({
    status,
    userId,
    payload: { text },
    sendMessage,
  }: BotHandlerArgsT): Promise<void> {
    const { roomId } = status;

    if (roomId === 'code') {
      const isExist = await this.roomService.findUnique({
        where: {
          code: text,
        },
      });
      if (isExist) {
        return sendMessage({
          text: 'This code is already taken(\nTry again!!!',
        });
      }
      await this.botRedisService.upsertPartlyRoom(userId, {
        code: text,
      });
      await this.botRedisService.upsertUserStatus(
        userId,
        BotUserStatusE.INPUT_NEW_ROOM,
        'title',
      );
      return sendMessage({
        text: 'Input Title of room',
      });
    }
    if (roomId === 'title') {
      const room = await this.botRedisService.getPartlyRoom(userId);
      if (!room) {
        throw new Error('Emty room at redis!');
      }

      await this.botRedisService.upsertPartlyRoom(userId, {
        ...room,
        title: text,
      });
      await this.botRedisService.upsertUserStatus(
        userId,
        BotUserStatusE.INPUT_NEW_ROOM,
        'description',
      );
      return sendMessage({
        text: 'Input Description of room',
      });
    }
    if (roomId === 'description') {
      const room = (await this.botRedisService.getPartlyRoom(
        userId,
      )) as Required<PartlyRoom>;
      if (!room) {
        throw new Error('Emty room at redis!');
      }
      const newRoom = await this.roomService.create({
        data: {
          ...room,
          description: text,
        },
      });

      await this.botRedisService.upsertUserStatus(userId, BotUserStatusE.FREE);

      await this.botRedisService.deletePartlyRoom(userId);

      return sendMessage({
        text: `Added new room ${newRoom.title}\nDescription: ${
          newRoom.description
        }\nCode ${newRoom.code}\nLink: ${this.configService.get(
          'BOT_URL',
        )}?start=${newRoom.code}`,
      });
    }
  }

  private async handleDisactivateRoom(args: BotHandlerArgsT): Promise<void> {
    const room = await this.roomService.findUnique({
      where: {
        id: args.payload.text,
      },
    });

    if (!room) {
      return args.sendMessage({
        text: `Room with code ${args.payload.text} doesn't exist`,
      });
    }

    await this.roomService.update({
      where: {
        id: room.id,
      },
      data: {
        isActive: false,
        blockedAt: new Date(),
      },
    });

    await this.botRedisService.upsertUserStatus(
      args.userId,
      BotUserStatusE.FREE,
    );

    return args.sendMessage({
      text: `Room ${room.title} with code ${room.code} disactivated successfuly`,
    });
  }
}
