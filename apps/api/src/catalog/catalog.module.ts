import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { parseEncryptionKey } from '../common/encryption.js';
import { ConnectorRegistry } from './connector.registry.js';
import { DemoConnector } from './demo/demo.connector.js';
import { PlatformConnector } from './platform/platform.connector.js';

@Module({
  providers: [
    DemoConnector,
    {
      provide: PlatformConnector,
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const timeoutMs = Number(config.get<string>('PLATFORM_TIMEOUT_MS'));
        return new PlatformConnector({
          timeoutMs:
            Number.isInteger(timeoutMs) && timeoutMs >= 1000 ? timeoutMs : 8000,
          encryptionKey: () =>
            parseEncryptionKey(config.get<string>('ENCRYPTION_KEY')),
        });
      },
    },
    ConnectorRegistry,
  ],
  exports: [ConnectorRegistry],
})
export class CatalogModule {}
