import { Module } from '@nestjs/common';
import { CatalogModule } from '../catalog/catalog.module.js';
import { ModelModule } from '../model/model.module.js';
import { AgentService } from './agent.service.js';
import { ConversationService } from './conversation.service.js';

@Module({
  imports: [CatalogModule, ModelModule],
  providers: [AgentService, ConversationService],
  exports: [AgentService, ConversationService],
})
export class AgentModule {}
