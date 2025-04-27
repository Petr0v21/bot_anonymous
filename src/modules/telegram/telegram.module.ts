import { DynamicModule, Module } from '@nestjs/common';
import { TelegramService } from './telegram.service';
import { Bot } from 'grammy';
import { TelegramController } from './telegram.controller';
import { UserModule } from '../user/user.module';
import { RabbitMQModule } from '../rabbitmq/rabbitmq.module';
import { RoomModule } from '../room/room.module';
import { TelegramBotRedisService } from './telegram-bot-redis.service';
import { TelegramBotHandlerService } from './telegram-bot-handler.service';

@Module({
  imports: [UserModule, RoomModule, RabbitMQModule],
  providers: [
    TelegramService,
    TelegramBotRedisService,
    TelegramBotHandlerService,
  ],
  controllers: [TelegramController],
  exports: [TelegramService, TelegramBotRedisService],
})
export class TelegramModule {
  static forRoot(token: string): DynamicModule {
    if (!token) {
      console.error('Bot Token EMPTY!');
      process.exit(1);
    }
    return {
      module: TelegramModule,
      providers: [
        {
          provide: 'BOT_TOKEN',
          useValue: token,
        },
        {
          provide: 'BOT',
          useValue: new Bot(token),
        },
        TelegramService,
      ],
      exports: [TelegramService],
    };
  }
}
