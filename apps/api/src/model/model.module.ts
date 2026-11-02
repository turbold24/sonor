import { Logger, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  loadModelConfig,
  MODEL_CONFIG,
  type ModelConfig,
} from './model.config.js';
import { createModelProvider } from './model-provider.factory.js';
import { ModelService } from './model.service.js';
import { MODEL_PROVIDER } from './model.types.js';
import { TokenBudgetService } from './token-budget.service.js';

@Module({
  providers: [
    {
      provide: MODEL_CONFIG,
      inject: [ConfigService],
      useFactory: (config: ConfigService): ModelConfig =>
        loadModelConfig((name) => config.get<string>(name)),
    },
    {
      provide: MODEL_PROVIDER,
      inject: [MODEL_CONFIG],
      useFactory: (config: ModelConfig) => {
        if (!config.apiKey) {
          new Logger('ModelModule').warn(
            'MODEL_API_KEY is not set; model calls will fail until it is.',
          );
        }
        return createModelProvider(config);
      },
    },
    TokenBudgetService,
    ModelService,
  ],
  exports: [ModelService],
})
export class ModelModule {}
