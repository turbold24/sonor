import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { HealthModule } from './health/health.module.js';

@Module({
  imports: [
    // `.env` lives at the repo root; the API usually runs with cwd apps/api.
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ['.env', '../../.env'],
    }),
    HealthModule,
  ],
})
export class AppModule {}
