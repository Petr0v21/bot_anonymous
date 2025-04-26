import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ValidationPipe } from '@nestjs/common';
import { MicroserviceOptions, Transport } from '@nestjs/microservices';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.enableCors();
  app.useGlobalPipes(new ValidationPipe());

  const port = Number(process.env.PORT ?? 3000);
  await app.listen(port);

  console.log(
    `✅ BotAnonymous listening on HTTP port ${port} and RabbitMQ queue 'tg_sender_queue'`,
  );
}
bootstrap();
