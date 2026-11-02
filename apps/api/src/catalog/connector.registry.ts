import { Injectable } from '@nestjs/common';
import { ConnectorType, type Tenant } from '../generated/prisma/client.js';
import type { CatalogConnector } from './catalog.types.js';
import { DemoConnector } from './demo/demo.connector.js';
import { PlatformConnector } from './platform/platform.connector.js';

@Injectable()
export class ConnectorRegistry {
  constructor(
    private readonly demo: DemoConnector,
    private readonly platform: PlatformConnector,
  ) {}

  forTenant(tenant: Tenant): CatalogConnector {
    return tenant.connectorType === ConnectorType.PLATFORM
      ? this.platform
      : this.demo;
  }
}
