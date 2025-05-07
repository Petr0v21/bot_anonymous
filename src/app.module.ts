import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { UserModule } from './modules/user/user.module';
import { UserService } from './modules/user/user.service';
import { TelegramService } from './modules/telegram/telegram.service';
import { TelegramModule } from './modules/telegram/telegram.module';
import { RedisModule } from './modules/redis/redis.module';
import { ConfigModule, ConfigService } from '@nestjs/config';

@Module({
  imports: [
    PrismaModule,
    ConfigModule.forRoot({
      isGlobal: true,
    }),
    RedisModule.forRootAsync({
      imports: [ConfigModule],
      useFactory: (configService: ConfigService) => ({
        host: configService.get<string>('REDIS_HOST'),
        port: configService.get<number>('REDIS_PORT'),
        password: configService.get<string>('REDIS_PASSWORD'),
        db: configService.get<number>('REDIS_DB') ?? 0,
      }),
      inject: [ConfigService],
    }),
    UserModule,
    TelegramModule.forRoot(process.env.BOT_TOKEN),
  ],
  providers: [UserService],
})
export class AppModule {
  constructor(private readonly telegramService: TelegramService) {
    this.telegramService.init({
      url:
        process.env.PUBLIC_URL + '/telegram-bot/webhook/' + process.env.BOT_ID,
      byWebhook: process.env.BOT_ON_WEBHOOK === 'true',
    });
  }
}
