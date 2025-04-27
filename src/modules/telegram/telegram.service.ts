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
  TgServiceMessageT,
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
    private readonly rabbitMQService: RabbitMQService,
    private readonly botRedisService: TelegramBotRedisService,
    private readonly handlerService: TelegramBotHandlerService,
  ) {
    configuration(this.bot);
    this.addListeners(bot);
  }

  inlineKeyboardBuilder(inline_keyboard_array: InlineKeyboardButton[][]) {
    return {
      reply_markup: {
        inline_keyboard: inline_keyboard_array,
      },
    };
  }

  async wrapper({ ctx, method, handler, middlewares }: BotHandlerWrapperT) {
    if (ctx.from.is_bot) {
      return;
    }

    const chatId = ctx.chat?.id;
    const userId = ctx.from?.id;

    if (!chatId || !userId) return;

    try {
      if (middlewares) {
        await middlewares({ ctx, chatId, userId });
      }

      return await handler({ ctx, chatId, userId });
    } catch (err) {
      this.logger.error(`❌ [${method}] Error:`, err);
      this.rabbitMQService.tgServiceEmit({
        payload: {
          botToken: this.bot_token,
          chatId: chatId.toString(),
          text: 'Oooppps! Something went wrong(((',
        },
        messageId: `${chatId}-${ctx.message.message_id}`,
      });
    }
  }

  async authAdminWrapper({ ctx, chatId, userId }: BotDefaultHandlerArgsT) {
    const user = await this.userService.findUnique({
      where: {
        id: userId.toString(),
        isAdmin: true,
      },
    });

    if (!user) {
      return this.rabbitMQService.tgServiceEmit({
        payload: {
          botToken: this.bot_token,
          chatId: chatId.toString(),
          text: 'Forbidden access',
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
          handler: async ({ ctx, chatId, userId }) => {
            const { id, ...body } = {
              id: ctx.from.id.toString(),
              firstName: ctx.from.first_name,
              lastName: ctx.from.last_name,
              username: ctx.from.username,
            };

            const user = await this.userService.upsert({
              where: {
                id: id,
              },
              create: { id, ...body },
              update: body,
            });

            this.rabbitMQService.tgServiceEmit({
              payload: {
                botToken: this.bot_token,
                chatId: chatId.toString(),
                text: 'Welcome to BotAnonymous!\nEnter /open for room connection',
              },
              messageId: `${chatId}-${ctx.message.message_id}`,
            });

            const { status } = await this.botRedisService.getUserStatus(userId);

            if (!status) {
              await this.botRedisService.upsertUserStatus(
                userId,
                BotUserStatusE.FREE,
              );
            }

            const deepLink = ctx.message.text.replace('/start', '').trim();

            if (deepLink) {
              const participant = await this.roomService.addParticipant(
                deepLink,
                user.id,
              );
              if (participant) {
                if (status === BotUserStatusE.PARTICIPANT) {
                  return this.rabbitMQService.tgServiceEmit({
                    payload: {
                      botToken: this.bot_token,
                      chatId: chatId.toString(),
                      text: 'Sorry! You must exit from current room, enter /exit and after it follow the link again or enter /open and code',
                    },
                    messageId: `${chatId}-${ctx.message.message_id}`,
                  });
                }
                this.rabbitMQService.tgServiceEmit({
                  payload: {
                    botToken: this.bot_token,
                    chatId: chatId.toString(),
                    text: 'Input username for room',
                  },
                  messageId: `${chatId}-${ctx.message.message_id}`,
                });
                await this.botRedisService.upsertUserStatus(
                  userId,
                  BotUserStatusE.INPUT_USERNAME,
                  participant.roomId,
                );
              }
            }
          },
        }),
    );

    bot.command(
      'new_admin',
      async (ctx) =>
        await this.wrapper({
          ctx,
          method: 'CommandNewAdmin',
          handler: async ({ ctx, chatId, userId }) => {
            this.rabbitMQService.tgServiceEmit({
              payload: {
                botToken: this.bot_token,
                chatId: chatId.toString(),
                text: 'Input telegram ID of new admin (that already started bot)',
              },
              messageId: `${chatId}-${ctx.message.message_id}`,
            });
            await this.botRedisService.upsertUserStatus(
              userId,
              BotUserStatusE.INPUT_NEW_ADMIN,
            );
          },
          middlewares: async (args) => this.authAdminWrapper(args),
        }),
    );

    bot.command(
      'new_room',
      async (ctx) =>
        await this.wrapper({
          ctx,
          method: 'CommandNewRoom',
          handler: async ({ ctx, chatId, userId }) => {
            this.rabbitMQService.tgServiceEmit({
              payload: {
                botToken: this.bot_token,
                chatId: chatId.toString(),
                text: 'Input Code for new Room',
              },
              messageId: `${chatId}-${ctx.message.message_id}`,
            });
            await this.botRedisService.upsertUserStatus(
              userId,
              BotUserStatusE.INPUT_NEW_ROOM,
              'code',
            );
          },
          middlewares: async (args) => this.authAdminWrapper(args),
        }),
    );

    bot.command(
      'disactivate_room',
      async (ctx) =>
        await this.wrapper({
          ctx,
          method: 'CommandDisactivateRoom',
          handler: async ({ ctx, chatId, userId }) => {
            this.rabbitMQService.tgServiceEmit({
              payload: {
                botToken: this.bot_token,
                chatId: chatId.toString(),
                text: 'Input room code',
              },
              messageId: `${chatId}-${ctx.message.message_id}`,
            });
            await this.botRedisService.upsertUserStatus(
              userId,
              BotUserStatusE.DISACTIVATE_ROOM,
            );
          },
          middlewares: async (args) => this.authAdminWrapper(args),
        }),
    );

    bot.command(
      'open',
      async (ctx) =>
        await this.wrapper({
          ctx,
          method: 'CommandOpen',
          handler: async ({ ctx, chatId, userId }) => {
            const { status } = await this.botRedisService.getUserStatus(userId);

            if (status && status === BotUserStatusE.PARTICIPANT) {
              return this.rabbitMQService.tgServiceEmit({
                payload: {
                  botToken: this.bot_token,
                  chatId: chatId.toString(),
                  text: 'Sorry! You must exit from current room, enter /exit and after it enter /open again',
                },
                messageId: `${chatId}-${ctx.message.message_id}`,
              });
            }

            await this.botRedisService.upsertUserStatus(
              userId,
              BotUserStatusE.INPUT_CODE,
            );

            this.rabbitMQService.tgServiceEmit({
              payload: {
                botToken: this.bot_token,
                chatId: chatId.toString(),
                text: 'Input room code',
              },
              messageId: `${chatId}-${ctx.message.message_id}`,
            });
          },
        }),
    );

    bot.command(
      'status',
      async (ctx) =>
        await this.wrapper({
          ctx,
          method: 'CommandStatus',
          handler: async ({ ctx, chatId, userId }) => {
            const currentStatus = await this.botRedisService.getUserStatus(
              userId,
            );

            return this.rabbitMQService.tgServiceEmit({
              payload: {
                botToken: this.bot_token,
                chatId: chatId.toString(),
                text: 'You status: ' + JSON.stringify(currentStatus, null, 2),
              },
              messageId: `${chatId}-${ctx.message.message_id}`,
            });
          },
        }),
    );

    bot.command(
      'exit',
      async (ctx) =>
        await this.wrapper({
          ctx,
          method: 'CommandExit',
          handler: async ({ ctx, chatId, userId }) => {
            const { status, roomId } = await this.botRedisService.getUserStatus(
              userId,
            );
            if (!status || status !== BotUserStatusE.PARTICIPANT) {
              return this.rabbitMQService.tgServiceEmit({
                payload: {
                  botToken: this.bot_token,
                  chatId: chatId.toString(),
                  text: 'You without active room now',
                },
                messageId: `${chatId}-${ctx.message.message_id}`,
              });
            }

            if (!roomId) {
              throw new Error('RoomId doesn`t provided!');
            }

            await this.participantService.upsert({
              where: {
                roomId_userId: {
                  roomId,
                  userId: userId.toString(),
                },
              },
              create: {
                roomId,
                userId: userId.toString(),
                isActive: false,
                exitedAt: new Date(),
              },
              update: {
                isActive: false,
                exitedAt: new Date(),
              },
            });

            await this.botRedisService.upsertUserStatus(
              userId,
              BotUserStatusE.FREE,
            );
            await this.botRedisService.removeUserFromRoom(userId, roomId);

            this.rabbitMQService.tgServiceEmit({
              payload: {
                botToken: this.bot_token,
                chatId: chatId.toString(),
                text: 'You successfuly exited from room. Input /open for open new room',
              },
              messageId: `${chatId}-${ctx.message.message_id}`,
            });
          },
        }),
    );

    bot.on(
      'msg:text',
      async (ctx) =>
        await this.wrapper({
          ctx,
          method: 'TextHandler',
          handler: async ({ ctx, chatId, userId }) => {
            const currentStatus = await this.botRedisService.getUserStatus(
              userId,
            );

            await this.handlerService.handle({
              userId,
              status: currentStatus,
              text: ctx.message.text.trim(),
              sendMessage: (
                payload: Omit<TgServiceMessageT, 'botToken' | 'chatId'>,
              ) =>
                this.rabbitMQService.tgServiceEmit({
                  payload: {
                    botToken: this.bot_token,
                    chatId: chatId.toString(),
                    ...payload,
                  },
                  messageId: `${chatId}-${ctx.message.message_id}`,
                }),
            });
          },
        }),
    );

    bot.on('callback_query:data', async (ctx) => {
      if (ctx.callbackQuery.data === 'info') {
        await ctx.reply('Info');
      }
      return await ctx.answerCallbackQuery();
    });
  }

  initWebhook(url: string): void {
    try {
      // this.bot.start()
      this.bot.api.setWebhook(`${url}`);
      this.bot.init();
      this.logger.log('Bot inited!!!');
    } catch (err) {
      this.logger.error('setWebhook Error: ', err);
    }
  }

  async handleUpdate(update: Update): Promise<void> {
    await this.bot.handleUpdate(update);
  }

  async getFilePath(
    file_id: string,
    botToken: string,
  ): Promise<string | undefined> {
    try {
      const response = await fetch(
        `https://api.telegram.org/bot${botToken}/getFile?file_id=${file_id}`,
      ).then((res) => res.json());
      if (response.ok) {
        return response.result.file_path;
      }
    } catch (err) {
      this.logger.error('getFilePath Error ', err.message);
    }
  }
}
