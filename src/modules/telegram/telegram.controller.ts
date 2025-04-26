import { Controller, Post, Body } from '@nestjs/common';
import { TelegramService } from './telegram.service';
import { Update } from 'grammy/types';

@Controller('telegram-bot')
export class TelegramController {
  constructor(private readonly telegramService: TelegramService) {}

  @Post('webhook')
  webhook(@Body() update: Update): void {
    this.telegramService.handleUpdate(update);
  }
}
