import { Inject, Injectable, Logger } from '@nestjs/common';
import { Api, Bot, Context, RawApi, InputFile } from 'grammy';
import { configuration } from './telegram.config';
import { UserService } from '../user/user.service';
import { InlineKeyboardButton, Update } from 'grammy/types';
import { ClientProxy } from '@nestjs/microservices';

@Injectable()
export class TelegramService {
  private logger: Logger = new Logger(TelegramService.name);

  constructor(
    @Inject('BOT') private readonly bot: Bot<Context, Api<RawApi>>,
    @Inject('BOT_TOKEN') private readonly bot_token: string,
    @Inject('TG_SENDER_SERVICE') private readonly tgSenderClient: ClientProxy,
    private readonly userService: UserService,
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

  addListeners(bot: Bot<Context, Api<RawApi>>) {
    bot.command('start', async (ctx) => {
      if (ctx.from.is_bot) {
        return;
      }

      const chatId = ctx.chat?.id;
      const userId = ctx.from?.id;

      if (!chatId || !userId) return;

      try {
        const body = {
          firstName: ctx.from.first_name,
          lastName: ctx.from.last_name,
          username: ctx.from.username,
        };

        const user = await this.userService.upsert({
          where: {
            telegramId: ctx.from.id.toString(),
          },
          create: {
            telegramId: ctx.from.id.toString(),
            ...body,
          },
          update: body,
        });
        this.tgSenderClient
          .emit('tg.send', {
            payload: {
              botToken: this.bot_token,
              chatId: chatId,
              text: 'Привет! Это сообщение из очереди!',
            },
            headers: {
              'x-original-routing-key': 'tg.send',
            },
          })
          .subscribe({
            error: (err) => {
              this.logger.error('Error at tgSenderClient.emit: ', err);
            },
          });
        return await ctx.reply('Hi! ' + user.username);
      } catch (err) {
        console.error('Ошибка при получении админов:', err);
        await ctx.reply(
          'Не удалось проверить админа. Возможно, это не групповая переписка?',
        );
      }
    });

    bot.on('callback_query:data', async (ctx) => {
      if (ctx.callbackQuery.data === 'info') {
        await ctx.reply('Info');
      }
      return await ctx.answerCallbackQuery();
    });
  }

  initWebhook(url: string): void {
    try {
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
