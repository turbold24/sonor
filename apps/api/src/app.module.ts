import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { HealthModule } from './health/health.module.js';
import { ModelModule } from './model/model.module.js';
import { PrismaModule } from './prisma/prisma.module.js';

@Module({
  imports: [
    // `.env` lives at the repo root; the API usually runs with cwd apps/api.
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ['.env', '../../.env'],
    }),
    PrismaModule,
    ModelModule,
    HealthModule,
  ],
})
export class AppModule {}
