import { Module } from '@nestjs/common';
import { AgentModule } from '../agent/agent.module.js';
import { DevController } from './dev.controller.js';

@Module({
  imports: [AgentModule],
  controllers: [DevController],
})
export class DevModule {}
