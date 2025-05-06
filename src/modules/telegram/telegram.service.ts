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
        const status = await middlewares({ ctx, chatId, userId });
        if (!status) return;
      }

      return await handler({ ctx, chatId, userId });
    } catch (err) {
      this.logger.error(`❌ [${method}] Error:`, err);
      this.rabbitMQService.tgServiceEmit({
        payload: {
          botToken: this.bot_token,
          chatId: chatId.toString(),
          type: TypeTelegramMessageE.SINGLE_CHAT,
          contentType: ContentTypeE.TEXT,
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
      this.rabbitMQService.tgServiceEmit({
        payload: {
          botToken: this.bot_token,
          chatId: chatId.toString(),
          type: TypeTelegramMessageE.SINGLE_CHAT,
          contentType: ContentTypeE.TEXT,
          text: 'Forbidden access',
        },
        messageId: `${chatId}-${ctx.message.message_id}`,
      });
      throw new Error('Forbidden access for ' + chatId);
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
                type: TypeTelegramMessageE.SINGLE_CHAT,
                contentType: ContentTypeE.TEXT,
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
                      type: TypeTelegramMessageE.SINGLE_CHAT,
                      contentType: ContentTypeE.TEXT,
                      text: 'Sorry! You must exit from current room, enter /exit and after it follow the link again or enter /open and code',
                    },
                    messageId: `${chatId}-${ctx.message.message_id}`,
                  });
                }
                this.rabbitMQService.tgServiceEmit({
                  payload: {
                    botToken: this.bot_token,
                    chatId: chatId.toString(),
                    type: TypeTelegramMessageE.SINGLE_CHAT,
                    contentType: ContentTypeE.TEXT,
                    text: `Input username for room ${
                      participant.username
                        ? `\nOr select your previous username`
                        : ''
                    }`,
                    ...(participant.username
                      ? {
                          replyMarkup: {
                            inline_keyboard: [
                              [
                                {
                                  text: participant.username,
                                  callback_data: `participant:${participant.roomId}:${participant.username}`,
                                },
                              ],
                            ],
                          },
                        }
                      : {}),
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
            const { status } = await this.botRedisService.getUserStatus(userId);
            if (status === BotUserStatusE.PARTICIPANT) {
              return this.rabbitMQService.tgServiceEmit({
                payload: {
                  botToken: this.bot_token,
                  chatId: chatId.toString(),
                  type: TypeTelegramMessageE.SINGLE_CHAT,
                  contentType: ContentTypeE.TEXT,
                  text: 'Exit from room!',
                },
                messageId: `${chatId}-${ctx.message.message_id}`,
              });
            }
            this.rabbitMQService.tgServiceEmit({
              payload: {
                botToken: this.bot_token,
                chatId: chatId.toString(),
                type: TypeTelegramMessageE.SINGLE_CHAT,
                contentType: ContentTypeE.TEXT,
                text: 'Input telegram ID of new admin (that already started bot)',
              },
              messageId: `${chatId}-${ctx.message.message_id}`,
            });
            await this.botRedisService.upsertUserStatus(
              userId,
              BotUserStatusE.INPUT_NEW_ADMIN,
            );
          },
          middlewares: async (args) => {
            try {
              await this.authAdminWrapper(args);
              return true;
            } catch (err) {
              this.logger.warn(`[CommandNewAdmin-AuthAdminWrapper] Warn:`, err);
              return false;
            }
          },
        }),
    );

    bot.command(
      'del_admin',
      async (ctx) =>
        await this.wrapper({
          ctx,
          method: 'CommandDeleteAdmin',
          handler: async ({ ctx, chatId, userId }) => {
            const { status, roomId } = await this.botRedisService.getUserStatus(
              userId,
            );
            if (status === BotUserStatusE.PARTICIPANT) {
              return this.rabbitMQService.tgServiceEmit({
                payload: {
                  botToken: this.bot_token,
                  chatId: chatId.toString(),
                  type: TypeTelegramMessageE.SINGLE_CHAT,
                  contentType: ContentTypeE.TEXT,
                  text: 'Exit from room!',
                },
                messageId: `${chatId}-${ctx.message.message_id}`,
              });
            }

            this.rabbitMQService.tgServiceEmit({
              payload: {
                botToken: this.bot_token,
                chatId: chatId.toString(),
                type: TypeTelegramMessageE.SINGLE_CHAT,
                contentType: ContentTypeE.TEXT,
                text: 'Input telegram ID of admin',
              },
              messageId: `${chatId}-${ctx.message.message_id}`,
            });
            await this.botRedisService.upsertUserStatus(
              userId,
              BotUserStatusE.INPUT_DEL_ADMIN,
            );
          },
          middlewares: async (args) => {
            try {
              await this.authAdminWrapper(args);
              return true;
            } catch (err) {
              this.logger.warn(
                `[CommandDeleteAdmin-AuthAdminWrapper] Warn:`,
                err,
              );
              return false;
            }
          },
        }),
    );

    bot.command(
      'admins',
      async (ctx) =>
        await this.wrapper({
          ctx,
          method: 'CommandListAdmins',
          handler: async ({ ctx, chatId }) => {
            let page: string | number = ctx.message.text
              .replace('/admins', '')
              .trim();

            if (!isNaN(Number(page))) {
              page = Number(page);
            }

            const admins = await this.userService.find({
              where: {
                isAdmin: true,
              },
              skip: typeof page === 'number' && page > 1 ? (page - 1) * 10 : 0,
              take: 10,
            });

            this.rabbitMQService.tgServiceEmit({
              payload: {
                botToken: this.bot_token,
                chatId: chatId.toString(),
                type: TypeTelegramMessageE.SINGLE_CHAT,
                contentType: ContentTypeE.TEXT,
                text:
                  `Admins list (page: ${
                    typeof page === 'number' && page > 1 ? page : 1
                  }): ${!admins.length ? 'Empty' : ''}` +
                  admins.map((admin) => `\n${admin.username} - ${admin.id}`),
              },
              messageId: `${chatId}-${ctx.message.message_id}`,
            });
          },
          middlewares: async (args) => {
            try {
              await this.authAdminWrapper(args);
              return true;
            } catch (err) {
              this.logger.warn(
                `[CommandListAdmins-AuthAdminWrapper] Warn:`,
                err,
              );
              return false;
            }
          },
        }),
    );

    bot.command(
      'new_room',
      async (ctx) =>
        await this.wrapper({
          ctx,
          method: 'CommandNewRoom',
          handler: async ({ ctx, chatId, userId }) => {
            const { status } = await this.botRedisService.getUserStatus(userId);
            if (status === BotUserStatusE.PARTICIPANT) {
              return this.rabbitMQService.tgServiceEmit({
                payload: {
                  botToken: this.bot_token,
                  chatId: chatId.toString(),
                  type: TypeTelegramMessageE.SINGLE_CHAT,
                  contentType: ContentTypeE.TEXT,
                  text: 'Exit from room!',
                },
                messageId: `${chatId}-${ctx.message.message_id}`,
              });
            }
            this.rabbitMQService.tgServiceEmit({
              payload: {
                botToken: this.bot_token,
                chatId: chatId.toString(),
                type: TypeTelegramMessageE.SINGLE_CHAT,
                contentType: ContentTypeE.TEXT,
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
          middlewares: async (args) => {
            try {
              await this.authAdminWrapper(args);
              return true;
            } catch (err) {
              this.logger.warn(`[CommandNewRoom-AuthAdminWrapper] Warn:`, err);
              return false;
            }
          },
        }),
    );

    bot.command(
      'disactivate_room',
      async (ctx) =>
        await this.wrapper({
          ctx,
          method: 'CommandDisactivateRoom',
          handler: async ({ ctx, chatId, userId }) => {
            const { status } = await this.botRedisService.getUserStatus(userId);

            if (status === BotUserStatusE.PARTICIPANT) {
              return this.rabbitMQService.tgServiceEmit({
                payload: {
                  botToken: this.bot_token,
                  chatId: chatId.toString(),
                  type: TypeTelegramMessageE.SINGLE_CHAT,
                  contentType: ContentTypeE.TEXT,
                  text: 'Exit from room!',
                },
                messageId: `${chatId}-${ctx.message.message_id}`,
              });
            }

            this.rabbitMQService.tgServiceEmit({
              payload: {
                botToken: this.bot_token,
                chatId: chatId.toString(),
                type: TypeTelegramMessageE.SINGLE_CHAT,
                contentType: ContentTypeE.TEXT,
                text: 'Input room code',
              },
              messageId: `${chatId}-${ctx.message.message_id}`,
            });

            await this.botRedisService.upsertUserStatus(
              userId,
              BotUserStatusE.DISACTIVATE_ROOM,
            );
          },
          middlewares: async (args) => {
            try {
              await this.authAdminWrapper(args);
              return true;
            } catch (err) {
              this.logger.warn(
                `[CommandDisactivateRoom-AuthAdminWrapper] Warn:`,
                err,
              );
              return false;
            }
          },
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
                  type: TypeTelegramMessageE.SINGLE_CHAT,
                  contentType: ContentTypeE.TEXT,
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
                type: TypeTelegramMessageE.SINGLE_CHAT,
                contentType: ContentTypeE.TEXT,
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
                type: TypeTelegramMessageE.SINGLE_CHAT,
                contentType: ContentTypeE.TEXT,
                text: 'You status: ' + JSON.stringify(currentStatus, null, 2),
              },
              messageId: `${chatId}-${ctx.message.message_id}`,
            });
          },
        }),
    );

    bot.command(
      'rooms',
      async (ctx) =>
        await this.wrapper({
          ctx,
          method: 'CommandRooms',
          handler: async ({ ctx, chatId, userId }) => {
            const rooms = await this.roomService.getUserRooms(
              userId.toString(),
            );
            return this.rabbitMQService.tgServiceEmit({
              payload: {
                botToken: this.bot_token,
                chatId: chatId.toString(),
                type: TypeTelegramMessageE.SINGLE_CHAT,
                contentType: ContentTypeE.TEXT,
                text: `${
                  rooms.length
                    ? 'To switch room click on buuton with room title)\n'
                    : ''
                }Your latest rooms: ${!rooms.length ? 'NULL' : '⬇️'}`,
                replyMarkup: {
                  inline_keyboard: rooms.map((room) => [
                    {
                      text: room.title,
                      callback_data: `room:${room.code}`,
                    },
                  ]),
                },
              },
              messageId: `${chatId}-${ctx.message.message_id}`,
            });
          },
        }),
    );

    bot.command(
      'del_room',
      async (ctx) =>
        await this.wrapper({
          ctx,
          method: 'CommandDeleteRoom',
          handler: async ({ ctx, chatId, userId }) => {
            const { status, roomId } = await this.botRedisService.getUserStatus(
              userId,
            );

            let rooms = await this.roomService.getUserRooms(userId.toString());

            if (status === BotUserStatusE.PARTICIPANT && roomId) {
              rooms = rooms.filter((item) => item.id !== roomId);
            }

            return this.rabbitMQService.tgServiceEmit({
              payload: {
                botToken: this.bot_token,
                chatId: chatId.toString(),
                type: TypeTelegramMessageE.SINGLE_CHAT,
                contentType: ContentTypeE.TEXT,
                text: rooms.length
                  ? 'Click on title room for delete from pool'
                  : 'Your enable rooms pool empty!',
                replyMarkup: {
                  inline_keyboard: rooms.map((room) => [
                    {
                      text: room.title,
                      callback_data: `delete_pool_room:${room.code}`,
                    },
                  ]),
                },
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
                  type: TypeTelegramMessageE.SINGLE_CHAT,
                  contentType: ContentTypeE.TEXT,
                  text: 'You without active room now',
                },
                messageId: `${chatId}-${ctx.message.message_id}`,
              });
            }

            if (!roomId || roomId === 'undefined') {
              throw new Error('RoomId doesn`t provided!');
            }

            await this.handlerService.exitFromRoom(userId, roomId);

            this.rabbitMQService.tgServiceEmit({
              payload: {
                botToken: this.bot_token,
                chatId: chatId.toString(),
                type: TypeTelegramMessageE.SINGLE_CHAT,
                contentType: ContentTypeE.TEXT,
                text: 'You successfuly exited from room. Input /open for open new room',
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
          handler: async ({ ctx, chatId, userId }) => {
            if (ctx.message.text && ctx.message.text.startsWith('/')) return;
            const currentStatus = await this.botRedisService.getUserStatus(
              userId,
            );

            let replyText = undefined;

            if (currentStatus.status === BotUserStatusE.PARTICIPANT) {
              const replyMessage = ctx.message.reply_to_message;
              if (replyMessage && replyMessage.from.is_bot) {
                replyText = this.handlerService.getReplyText(
                  replyMessage.text ?? replyMessage.caption,
                );
              }
            }

            const payload: MessagePayload =
              currentStatus.status === BotUserStatusE.PARTICIPANT
                ? this.handlerService.buildMessagePayloadFromCtx(ctx)
                : {
                    contentType: ContentTypeE.TEXT,
                    text: ctx.message.text ?? ctx.message.caption,
                  };

            await this.handlerService.handle({
              userId,
              status: currentStatus,
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

    bot.on('callback_query:data', async (ctx) => {
      try {
        const currentStatus = await this.botRedisService.getUserStatus(
          ctx.from.id,
        );
        if (ctx.callbackQuery.data.startsWith('room:')) {
          const code = ctx.callbackQuery.data.replace('room:', '').trim();
          if (!code) {
            throw new Error('Empty code!');
          }
          await this.handlerService.switchRoom(
            ctx.from.id,
            currentStatus,
            code,
            (payload) => {
              this.rabbitMQService.tgServiceEmit({
                payload: {
                  botToken: this.bot_token,
                  chatId: ctx.from.id.toString(),
                  type: TypeTelegramMessageE.SINGLE_CHAT,
                  contentType: ContentTypeE.TEXT,
                  ...payload,
                },
                messageId: `${ctx.from.id}-${ctx.callbackQuery.id}`,
              });
            },
          );
        }
        if (ctx.callbackQuery.data.startsWith('participant:')) {
          const sepKey = ctx.callbackQuery.data.split(':');
          if (sepKey.length !== 3) {
            throw new Error('Empty code!');
          }

          await this.handlerService.handleInputUsername({
            payload: {
              text: sepKey[2],
              contentType: ContentTypeE.TEXT,
            },
            status: currentStatus,
            userId: ctx.from.id,
            sendMessage: (
              payload: Omit<TgServiceMessageT, 'botToken' | 'chatId'>,
            ) =>
              this.rabbitMQService.tgServiceEmit({
                payload: {
                  botToken: this.bot_token,
                  chatId: ctx.from.id.toString(),
                  type: TypeTelegramMessageE.SINGLE_CHAT,
                  contentType: ContentTypeE.TEXT,
                  ...payload,
                },
                messageId: `${ctx.from.id}-callback_data`,
              }),
          });
        }
        if (ctx.callbackQuery.data.startsWith('delete_pool_room:')) {
          const code = ctx.callbackQuery.data
            .replace('delete_pool_room:', '')
            .trim();
          if (!code) {
            throw new Error('Empty code!');
          }
          const room = await this.roomService.findUnique({
            where: {
              code,
              participants: {
                some: {
                  userId: ctx.from.id.toString(),
                },
              },
            },
          });
          if (!room) {
            throw new Error('Your pool already haven`t this room!');
          }
          if (currentStatus.roomId && room.id === currentStatus.roomId) {
            throw new Error('You can`t delete this room once you`re in it');
          }
          const result = await this.participantService.removeParticipant(
            room.id,
            ctx.from.id.toString(),
          );
          if (!result) {
            throw new Error();
          }
          this.rabbitMQService.tgServiceEmit({
            payload: {
              botToken: this.bot_token,
              chatId: ctx.from.id.toString(),
              type: TypeTelegramMessageE.SINGLE_CHAT,
              contentType: ContentTypeE.TEXT,
              text: `Your successfuly remove room (${room.title}) from your pool!`,
            },
            messageId: `${ctx.from.id}-${ctx.callbackQuery.id}`,
          });
        }
      } catch (err) {
        this.rabbitMQService.tgServiceEmit({
          payload: {
            botToken: this.bot_token,
            chatId: ctx.from.id.toString(),
            type: TypeTelegramMessageE.SINGLE_CHAT,
            contentType: ContentTypeE.TEXT,
            text: String(err.message).length
              ? err.message
              : 'Invalid callback_query data',
          },
          messageId: `${ctx.from.id}-${ctx.callbackQuery.id}`,
        });
      }
      return await ctx.answerCallbackQuery();
    });
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
      this.logger.log('✅[Init Bot] Bot inited!!!');
    } catch (err) {
      this.logger.error('❌[Init Bot] Error: ', err);
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
