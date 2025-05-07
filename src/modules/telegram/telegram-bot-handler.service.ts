import { Injectable, Logger } from '@nestjs/common';
import {
  BotHandlerArgsT,
  BotUserStatusE,
  ContentTypeE,
  MessagePayload,
  TypeTelegramMessageE,
} from 'src/utils/types';
import { ParticipantService } from '../room/participant.service';
import { TelegramBotRedisService } from './telegram-bot-redis.service';
import { RabbitMQService } from '../rabbitmq/rabbitmq.service';
import { ConfigService } from '@nestjs/config';
import { Context } from 'grammy';

@Injectable()
export class TelegramBotHandlerService {
  private logger: Logger = new Logger(TelegramBotHandlerService.name);

  constructor(
    private readonly participantService: ParticipantService,
    private readonly botRedisService: TelegramBotRedisService,
    private readonly rabbitMQService: RabbitMQService,
    private readonly configService: ConfigService,
  ) {}

  getReplyText(text?: string) {
    if (!text || !text.startsWith('👤')) {
      return;
    }

    const usernameLastIndex = text.indexOf('\n');

    const username = text.slice(
      3,
      usernameLastIndex === -1 ? text.length : usernameLastIndex,
    );

    if (!username) {
      return;
    }

    const messageStartIndex = text.indexOf('📃');

    let message: string | null = null;
    if (messageStartIndex !== -1) {
      const originalMessage = text.slice(messageStartIndex + 3);
      message =
        originalMessage.length > 36
          ? originalMessage.slice(0, 24) + '...'
          : originalMessage;
    }

    return `👤 <b>${username}</b>${message ? ': ' + message : ''}`;
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

  async handleInputUsername({
    userId,
    roomId,
    ...args
  }: BotHandlerArgsT): Promise<void> {
    const username = args.payload.text;

    if (!username || username.includes('\n') || username.length > 64) {
      return args.sendMessage({
        text: `Your username length must be less than 64 and in one row!\nTry again!`,
      });
    }

    const isExistUsername = await this.participantService.findUnique({
      where: {
        username_roomId: {
          username,
          roomId,
        },
      },
    });

    if (isExistUsername && userId !== isExistUsername.userId) {
      return args.sendMessage({
        text: `This username: ${username} already exist! Try another name!`,
      });
    }

    const participant = await this.participantService.update({
      where: {
        roomId_userId: {
          roomId,
          userId,
        },
      },
      data: {
        isActive: true,
        username,
      },
    });

    await this.botRedisService.upsertUserStatus(
      userId,
      roomId,
      BotUserStatusE.PARTICIPANT,
    );

    await this.botRedisService.addUserToRoom(userId, roomId, participant);

    args.sendMessage({
      text: `Welcome ${username} to chat\n You can write and listen to this chat`,
    });
  }

  async handleParticipantMessage({
    userId,
    roomId,
    payload,
  }: BotHandlerArgsT): Promise<void> {
    const participant = await this.botRedisService.getParticipant(
      roomId,
      userId,
    );

    if (!participant) {
      throw new Error('Not Active or Empty Participant');
    }

    const users = await this.botRedisService.getActiveUserIdsInRoom(roomId);

    users.forEach((listenerId) => {
      if (listenerId === userId) {
        return;
      }

      this.rabbitMQService.tgServiceEmit({
        payload: {
          botToken: this.configService.get('BOT_TOKEN'),
          chatId: listenerId,
          ...payload,
          text: `👤 <b>${participant.username}</b>\n${
            payload.replyText ? `↪️${payload.replyText}\n` : ''
          }${payload.text ? `📃 ${payload.text}` : ''}`,
          type: TypeTelegramMessageE.SINGLE_CHAT,
        },
        messageId: `${userId}-fanout-${listenerId}`,
      });
    });
  }
}
