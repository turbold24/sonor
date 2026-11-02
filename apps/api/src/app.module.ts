import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AgentModule } from './agent/agent.module.js';
import { DevModule } from './dev/dev.module.js';
import { HealthModule } from './health/health.module.js';
import { ModelModule } from './model/model.module.js';
import { PrismaModule } from './prisma/prisma.module.js';

@Module({
  imports: [
    // `.env` lives at the repo root; the API usually runs with cwd apps/api.
    // forRoot loads it into process.env, so the NODE_ENV check below sees it.
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ['.env', '../../.env'],
    }),
    PrismaModule,
    ModelModule,
    AgentModule,
    HealthModule,
    ...(process.env.NODE_ENV === 'production' ? [] : [DevModule]),
  ],
})
export class AppModule {}
