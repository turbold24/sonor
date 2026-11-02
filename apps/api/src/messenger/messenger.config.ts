export interface MessengerConfig {
  /** Must match the Verify Token set in the Meta app's webhook settings. */
  verifyToken: string | undefined;
  /** Signs incoming webhooks and outgoing appsecret_proof. Webhooks are rejected without it. */
  appSecret: string | undefined;
  /** Optional: echoes from this app are recognized as Sonor's own replies. */
  appId: string | undefined;
  graphVersion: string;
}

export const MESSENGER_CONFIG = Symbol('MESSENGER_CONFIG');

export function loadMessengerConfig(
  get: (name: string) => string | undefined,
): MessengerConfig {
  const value = (name: string) => get(name)?.trim() || undefined;
  const graphVersion = value('GRAPH_API_VERSION') ?? 'v26.0';
  if (!/^v\d+\.\d+$/.test(graphVersion)) {
    throw new Error('GRAPH_API_VERSION must look like v26.0');
  }
  return {
    verifyToken: value('MESSENGER_VERIFY_TOKEN'),
    appSecret: value('MESSENGER_APP_SECRET'),
    appId: value('MESSENGER_APP_ID'),
    graphVersion,
  };
}
