import { Api, Bot, Context, GrammyError, HttpError, RawApi } from 'grammy';
import { limit } from '@grammyjs/ratelimiter';
import { autoRetry } from '@grammyjs/auto-retry';
import { apiThrottler } from '@grammyjs/transformer-throttler';

export const configuration = (bot: Bot<Context, Api<RawApi>>) => {
  const throttler = apiThrottler();
  bot.use(
    limit({
      timeFrame: Number(process.env.BOT_MESSAGES_TIME_FRAME ?? 3000),
      limit: Number(process.env.BOT_MESSAGES_LIMIT ?? 2),

      onLimitExceeded: async (ctx) => {
        await ctx.reply('Please refrain from sending too many requests!');
      },
      keyGenerator: (ctx) => {
        return ctx.from?.id.toString();
      },
    }),
  );

  bot.api.config.use(
    autoRetry({
      maxDelaySeconds: Number(process.env.BOT_AUTO_RETRY_MAX_DELAY ?? 5),
      maxRetryAttempts: Number(process.env.BOT_AUTO_RETRY_MAX_ATTEMPTS ?? 1),
    }),
  );
  bot.api.config.use(throttler);

  bot.catch((err) => {
    const ctx = err.ctx;
    console.error(
      `Error while handling update ${ctx.update.update_id} at ${ctx.me.username}:`,
    );
    const e = err.error;
    if (e instanceof GrammyError) {
      console.error('Error in request:', e.description, e);
    } else if (e instanceof HttpError) {
      console.error('Could not contact Telegram:', e);
    } else {
      console.error('Unknown error:', e);
    }
  });
};
