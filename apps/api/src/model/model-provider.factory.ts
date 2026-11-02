import type { ModelConfig } from './model.config.js';
import type { ModelProvider } from './model.types.js';
import {
  MetaModelProvider,
  type MetaModelProviderDeps,
} from './meta/meta-model.provider.js';

// Add new providers here (e.g. an OpenAI-compatible Chat Completions provider for
// Muse Spark Open on Baseten) and register their name in MODEL_PROVIDERS.
export function createModelProvider(
  config: ModelConfig,
  deps?: MetaModelProviderDeps,
): ModelProvider {
  switch (config.provider) {
    case 'meta':
      return new MetaModelProvider(config, deps);
  }
}
