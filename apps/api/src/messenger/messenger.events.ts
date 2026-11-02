// Parses Messenger webhook payloads (object "page") into the events Sonor handles.
// See dev docs: webhooks/webhook-events/messages, message-echoes, messaging_postbacks.

export interface MessengerAttachment {
  type: string;
  payload?: unknown;
}

interface BaseEvent {
  /** entry[].id: the Page the event belongs to. */
  pageId: string;
  /** The customer's Page-scoped ID. */
  psid: string;
  mid: string;
  text: string;
  attachments: MessengerAttachment[];
}

/** A message from a customer, or a postback (button tap) treated as one. */
export interface CustomerMessageEvent extends BaseEvent {
  kind: 'message';
}

/** A message the Page sent: by Sonor itself, or by the owner from the Page inbox. */
export interface EchoEvent extends BaseEvent {
  kind: 'echo';
  appId?: string;
  metadata?: string;
}

export type MessengerEvent = CustomerMessageEvent | EchoEvent;

/** Events we act on. Delivery receipts, reads, reactions and other objects are skipped. */
export function parseWebhook(payload: unknown): MessengerEvent[] {
  if (!isRecord(payload) || payload.object !== 'page') return [];
  const events: MessengerEvent[] = [];

  for (const entry of array(payload.entry)) {
    const pageId = id(entry.id);
    if (!pageId) continue;

    for (const item of array(entry.messaging)) {
      const sender = isRecord(item.sender) ? id(item.sender.id) : undefined;
      const recipient = isRecord(item.recipient)
        ? id(item.recipient.id)
        : undefined;

      if (isRecord(item.message)) {
        const message = item.message;
        const mid = string(message.mid);
        if (!mid) continue;
        const base = {
          pageId,
          mid,
          text: string(message.text) ?? '',
          attachments: attachments(message.attachments),
        };
        if (message.is_echo === true) {
          // Echo: the Page is the sender and the customer the recipient.
          if (recipient) {
            events.push({
              ...base,
              kind: 'echo',
              psid: recipient,
              appId: id(message.app_id),
              metadata: string(message.metadata),
            });
          }
        } else if (sender) {
          events.push({ ...base, kind: 'message', psid: sender });
        }
      } else if (isRecord(item.postback) && sender) {
        const postback = item.postback;
        const mid = string(postback.mid);
        const text = string(postback.title) ?? string(postback.payload);
        if (mid && text) {
          events.push({
            kind: 'message',
            pageId,
            psid: sender,
            mid,
            text,
            attachments: [],
          });
        }
      }
    }
  }
  return events;
}

function attachments(value: unknown): MessengerAttachment[] {
  return array(value).flatMap((item) => {
    const type = string(item.type);
    return type ? [{ type, payload: item.payload }] : [];
  });
}

function array(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? value.filter(isRecord) : [];
}

/** Meta IDs arrive as strings, but app_id may be a number. */
function id(value: unknown): string | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return typeof value === 'string' && value ? value : undefined;
}

function string(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
