import { Inject, Injectable, Logger } from '@nestjs/common';
import { ClientProxy } from '@nestjs/microservices';
import { TgServiceEmitArgsT } from 'src/utils/types';

@Injectable()
export class RabbitMQService {
  private logger: Logger = new Logger(RabbitMQService.name);

  constructor(
    @Inject('TG_SENDER_SERVICE') private readonly tgSenderClient: ClientProxy,
  ) {}

  tgServiceEmit({ payload, messageId }: TgServiceEmitArgsT) {
    this.tgSenderClient
      .emit('tg.send', {
        payload,
        headers: {
          'x-original-routing-key': 'tg.send',
          'message-id': messageId,
        },
      })
      .subscribe({
        error: (err) => {
          this.logger.error('Error at tgSenderClient.emit: ', err);
        },
      });
  }
}
