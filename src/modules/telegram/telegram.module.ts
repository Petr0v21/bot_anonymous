import { DynamicModule, Module } from '@nestjs/common';
import { TelegramService } from './telegram.service';
import { Bot } from 'grammy';
import { TelegramController } from './telegram.controller';
import { UserModule } from '../user/user.module';
import { ClientsModule, Transport } from '@nestjs/microservices';
import { ConfigModule, ConfigService } from '@nestjs/config';

@Module({
  imports: [
    UserModule,
    ClientsModule.registerAsync([
      {
        name: 'TG_SENDER_SERVICE',
        imports: [ConfigModule],
        useFactory: (configService: ConfigService) => ({
          transport: Transport.RMQ,
          options: {
            urls: [configService.get<string>('RABBITMQ_URL')],
            queue: configService.get<string>('RABBITMQ_QUEUE'),
            noAck: true,
            queueOptions: {
              durable: true,
              arguments: {
                'x-message-ttl': 60000,
                'x-dead-letter-exchange': 'dlx_exchange',
                'x-dead-letter-routing-key': 'dlx_routing_key',
              },
            },
          },
        }),
        inject: [ConfigService],
      },
    ]),
  ],
  providers: [TelegramService],
  controllers: [TelegramController],
  exports: [TelegramService],
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
