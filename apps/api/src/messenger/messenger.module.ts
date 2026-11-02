import { Logger, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AgentModule } from '../agent/agent.module.js';
import { GraphClient } from './graph.client.js';
import {
  loadMessengerConfig,
  MESSENGER_CONFIG,
  type MessengerConfig,
} from './messenger.config.js';
import { MessengerController } from './messenger.controller.js';
import { MessengerService } from './messenger.service.js';

@Module({
  imports: [AgentModule],
  controllers: [MessengerController],
  providers: [
    {
      provide: MESSENGER_CONFIG,
      inject: [ConfigService],
      useFactory: (config: ConfigService): MessengerConfig => {
        const messenger = loadMessengerConfig((name) =>
          config.get<string>(name),
        );
        if (!messenger.verifyToken || !messenger.appSecret) {
          new Logger('MessengerModule').warn(
            'MESSENGER_VERIFY_TOKEN or MESSENGER_APP_SECRET is not set; the Messenger webhook will reject requests.',
          );
        }
        return messenger;
      },
    },
    {
      provide: GraphClient,
      inject: [MESSENGER_CONFIG],
      useFactory: (config: MessengerConfig) =>
        new GraphClient({
          version: config.graphVersion,
          appSecret: config.appSecret,
        }),
    },
    MessengerService,
  ],
  exports: [MessengerService],
})
export class MessengerModule {}
