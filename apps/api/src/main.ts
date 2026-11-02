import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';

async function bootstrap() {
  // rawBody keeps the exact request bytes, which the Messenger signature check needs.
  const app = await NestFactory.create(AppModule, { rawBody: true });
  app.enableShutdownHooks();

  const port = app.get(ConfigService).get<number>('PORT', 3000);
  await app.listen(port);
  Logger.log(`Sonor API listening on http://localhost:${port}`, 'Bootstrap');
}
await bootstrap();
