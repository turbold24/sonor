export type ModelErrorKind =
  | 'config'
  | 'auth'
  | 'billing'
  | 'bad_request'
  | 'rate_limit'
  | 'server'
  | 'timeout'
  | 'network'
  | 'invalid_response'
  | 'budget_exceeded';

export interface ModelErrorDetails {
  status?: number;
  code?: string | null;
  retryAfterMs?: number;
}

export class ModelError extends Error {
  constructor(
    readonly kind: ModelErrorKind,
    message: string,
    readonly details: ModelErrorDetails = {},
    readonly retryable = false,
  ) {
    super(message);
    this.name = 'ModelError';
  }
}
