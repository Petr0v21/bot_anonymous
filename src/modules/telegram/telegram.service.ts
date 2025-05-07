import { Inject, Injectable, Logger } from '@nestjs/common';
import { Api, Bot, Context, RawApi } from 'grammy';
import { configuration } from './telegram.config';
import { UserService } from '../user/user.service';
import { InlineKeyboardButton, Update } from 'grammy/types';
import { RabbitMQService } from '../rabbitmq/rabbitmq.service';
import { RoomService } from '../room/room.service';
import { ParticipantService } from '../room/participant.service';
import {
  BotDefaultHandlerArgsT,
  BotHandlerWrapperT,
  BotUserStatusE,
  ContentTypeE,
  MessagePayload,
  TgServiceMessageT,
  TypeTelegramMessageE,
} from 'src/utils/types';
import { TelegramBotRedisService } from './telegram-bot-redis.service';
import { TelegramBotHandlerService } from './telegram-bot-handler.service';

@Injectable()
export class TelegramService {
  private logger: Logger = new Logger(TelegramService.name);

  constructor(
    @Inject('BOT') private readonly bot: Bot<Context, Api<RawApi>>,
    @Inject('BOT_TOKEN') private readonly bot_token: string,
    private readonly userService: UserService,
    private readonly roomService: RoomService,
    private readonly participantService: ParticipantService,
    private readonly handlerService: TelegramBotHandlerService,
    private readonly rabbitMQService: RabbitMQService,
    private readonly residService: TelegramBotRedisService,
  ) {
    configuration(this.bot);
    this.addListeners(bot);
  }

  async wrapper({ ctx, method, handler, middlewares }: BotHandlerWrapperT) {
    if (ctx.from.is_bot) {
      return;
    }

    const chatId = ctx.chat?.id;
    const userId = ctx.from?.id?.toString();
    const roomId = process.env.BOT_ID;

    if (!chatId || !userId) return;

    try {
      if (middlewares) {
        const status = await middlewares({ ctx, chatId, userId, roomId });
        if (!status) return;
      }

      return await handler({ ctx, chatId, userId, roomId });
    } catch (err) {
      this.logger.error(`❌ [${method}] Error:`, err);
      this.rabbitMQService.tgServiceEmit({
        payload: {
          botToken: this.bot_token,
          chatId: chatId.toString(),
          type: TypeTelegramMessageE.SINGLE_CHAT,
          contentType: ContentTypeE.TEXT,
          text: err.message ?? 'Oooppps! Something went wrong(((',
        },
        messageId: `${chatId}-${ctx.message.message_id}`,
      });
    }
  }

  addListeners(bot: Bot<Context, Api<RawApi>>) {
    bot.command(
      'start',
      async (ctx) =>
        await this.wrapper({
          ctx,
          method: 'CommandStart',
          handler: async ({ ctx, chatId, userId, roomId }) => {
            const room = await this.roomService.findUnique({
              where: { id: roomId },
            });

            if (!room) {
              throw new Error('Can`t find room by roomId:' + roomId);
            }

            const { id, ...body } = {
              id: ctx.from.id.toString(),
              firstName: ctx.from.first_name,
              lastName: ctx.from.last_name,
              username: ctx.from.username,
            };

            await this.userService.upsert({
              where: {
                id: id,
              },
              create: { id, ...body },
              update: body,
            });

            const participant = await this.participantService.upsert({
              where: {
                roomId_userId: {
                  roomId,
                  userId,
                },
              },
              create: {
                roomId,
                userId,
                isActive: false,
              },
              update: {
                roomId,
                userId,
              },
            });

            this.rabbitMQService.tgServiceEmit({
              payload: {
                botToken: this.bot_token,
                chatId: chatId.toString(),
                type: TypeTelegramMessageE.SINGLE_CHAT,
                contentType: ContentTypeE.TEXT,
                text:
                  room.description ??
                  'Welcome to BotAnonymous!\nEnter /open for room connection\nBOT_ID: ' +
                    process.env.BOT_ID,
              },
              messageId: `${chatId}-${ctx.message.message_id}`,
            });

            if (!participant.username) {
              this.rabbitMQService.tgServiceEmit({
                payload: {
                  botToken: this.bot_token,
                  chatId: chatId.toString(),
                  type: TypeTelegramMessageE.SINGLE_CHAT,
                  contentType: ContentTypeE.TEXT,
                  text: 'Input Username!',
                },
                messageId: `${chatId}-${ctx.message.message_id}`,
              });
              await this.residService.upsertUserStatus(
                userId,
                roomId,
                BotUserStatusE.INPUT_USERNAME,
              );
            } else if (!participant.isActive) {
              const _participant = await this.participantService.update({
                where: {
                  roomId_userId: {
                    roomId,
                    userId,
                  },
                },
                data: {
                  isActive: true,
                },
              });
              await this.residService.addUserToRoom(
                userId,
                roomId,
                _participant,
              );
              await this.residService.upsertUserStatus(
                userId,
                roomId,
                BotUserStatusE.PARTICIPANT,
              );
            }
          },
        }),
    );

    bot.command(
      'stop',
      async (ctx) =>
        await this.wrapper({
          ctx,
          method: 'CommandStop',
          handler: async ({ ctx, chatId, userId, roomId }) => {
            const room = await this.roomService.findUnique({
              where: { id: roomId },
            });

            if (!room) {
              throw new Error('Can`t find room by roomId:' + roomId);
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
              new Error('Can`t find this user!');
            }

            if (!participant.isActive) {
              throw new Error('Open chat before stop it!');
            }

            await this.participantService.update({
              where: {
                roomId_userId: {
                  roomId,
                  userId,
                },
              },
              data: {
                isActive: false,
              },
            });
            await this.residService.removeUserFromRoom(userId, roomId);
            await this.residService.upsertUserStatus(
              userId,
              roomId,
              BotUserStatusE.FREE,
            );

            this.rabbitMQService.tgServiceEmit({
              payload: {
                botToken: this.bot_token,
                chatId: chatId.toString(),
                type: TypeTelegramMessageE.SINGLE_CHAT,
                contentType: ContentTypeE.TEXT,
                text: 'You successuly stop chat, for listen chat again enter /start',
              },
              messageId: `${chatId}-${ctx.message.message_id}`,
            });
          },
        }),
    );

    bot.on(
      'msg',
      async (ctx) =>
        await this.wrapper({
          ctx,
          method: 'MessageHandler',
          handler: async ({ ctx, chatId, userId, roomId }) => {
            const text: string | undefined =
              ctx.message.text ?? ctx.message.caption;
            if (!text || text.startsWith('/')) return;

            const status = await this.residService.getUserStatus(
              userId,
              roomId,
            );

            if (!status || status === BotUserStatusE.FREE) {
              return;
            }

            if (status === BotUserStatusE.INPUT_USERNAME) {
              return await this.handlerService.handleInputUsername({
                roomId,
                userId,
                payload: {
                  text,
                  contentType: ContentTypeE.TEXT,
                },
                sendMessage: (
                  payload: Omit<TgServiceMessageT, 'botToken' | 'chatId'>,
                ) =>
                  this.rabbitMQService.tgServiceEmit({
                    payload: {
                      botToken: this.bot_token,
                      chatId: chatId.toString(),
                      type: TypeTelegramMessageE.SINGLE_CHAT,
                      contentType: ContentTypeE.TEXT,
                      ...payload,
                    },
                    messageId: `${chatId}-${ctx.message.message_id}`,
                  }),
              });
            }

            let replyText = undefined;

            const replyMessage = ctx.message.reply_to_message;
            if (replyMessage && replyMessage.from.is_bot) {
              replyText = this.handlerService.getReplyText(
                replyMessage.text ?? replyMessage.caption,
              );
            }

            const payload = this.handlerService.buildMessagePayloadFromCtx(ctx);

            await this.handlerService.handleParticipantMessage({
              userId,
              roomId,
              payload: {
                ...payload,
                text: payload.text?.trim(),
                replyText,
              },
              sendMessage: (
                payload: Omit<TgServiceMessageT, 'botToken' | 'chatId'>,
              ) =>
                this.rabbitMQService.tgServiceEmit({
                  payload: {
                    botToken: this.bot_token,
                    chatId: chatId.toString(),
                    type: TypeTelegramMessageE.SINGLE_CHAT,
                    contentType: ContentTypeE.TEXT,
                    ...payload,
                  },
                  messageId: `${chatId}-${ctx.message.message_id}`,
                }),
            });
          },
        }),
    );
  }

  init(args: { url?: string; byWebhook?: boolean }): void {
    try {
      if (args.byWebhook) {
        if (!args.url) {
          this.logger.error('❌[Init Bot] Webhook URL Emty!');
          process.exit(1);
        }
        this.bot.api.setWebhook(`${args.url}`);
        this.bot.init();
      } else {
        this.bot.start();
      }

      this.bot.api.getMe().then(async (res) => {
        await this.roomService.upsert({
          where: {
            id: res.id.toString(),
          },
          create: {
            id: res.id.toString(),
            isActive: true,
            title: res.username,
            botToken: this.bot_token,
            webhook: process.env.APP_ORIGIN + '/telegram-bot/webhook/',
          },
          update: {
            id: res.id.toString(),
            isActive: true,
            title: res.username,
            botToken: this.bot_token,
            webhook: process.env.APP_ORIGIN + '/telegram-bot/webhook/',
          },
        });
      });
      this.logger.log('✅[Init Bot] Bot inited!!!');
    } catch (err) {
      this.logger.error('❌[Init Bot] Error: ', err);
    }
  }

  async handleUpdate(update: Update): Promise<void> {
    await this.bot.handleUpdate(update);
  }
}
