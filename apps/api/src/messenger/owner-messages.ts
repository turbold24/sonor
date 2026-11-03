import { createHash, randomInt } from 'node:crypto';
import { formatMnt } from '../orders/order-messages.js';

// The shop owner's side of Messenger: a one-time code links their personal account,
// then Sonor sends them alerts there and takes a few "/" commands.

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const LINK_CODE = /^SONOR-[A-Z2-9]{6}$/;

export function newLinkCode(): string {
  let code = '';
  for (let i = 0; i < 6; i++)
    code += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)];
  return `SONOR-${code}`;
}

/** The normalized link code in a message, or null if the message isn't one. */
export function linkCodeIn(text: string): string | null {
  const code = text.trim().toUpperCase();
  return LINK_CODE.test(code) ? code : null;
}

export function hashLinkCode(code: string): string {
  return createHash('sha256').update(code).digest('hex');
}

export type OwnerCommand = { kind: 'resume'; code: string } | { kind: 'help' };

/** Owner commands start with "/"; anything else from the owner is a normal message. */
export function parseOwnerCommand(text: string): OwnerCommand | null {
  const match = /^\/(\S+)\s*(.*)$/s.exec(text.trim());
  if (!match) return null;
  const [, name, rest] = match;
  if (/^(resume|асаа|asaa)$/i.test(name)) {
    const code = /[A-Za-z0-9]{6}/.exec(rest)?.[0];
    if (code) return { kind: 'resume', code: code.toUpperCase() };
  }
  return { kind: 'help' };
}

/** Short code for a conversation, e.g. #K3F9Q2. */
export function chatCode(conversationId: string): string {
  return conversationId.slice(-6).toUpperCase();
}

export function linkedReply(shopName: string): string {
  return `Та "${shopName}"-ийн эзэмшигчээр холбогдлоо. Хүнд шилжүүлсэн чат, төлөгдсөн захиалгын мэдэгдлийг энд авна. Командууд: /help`;
}

export function helpReply(): string {
  return [
    'Sonor эзэмшигчийн командууд:',
    '/resume КОД: тухайн чатад ботыг дахин асаана (код мэдэгдэл дээр байгаа).',
    '/help: энэ тайлбар.',
    'Бусад мессеж тань энгийн харилцагчийн мессеж шиг ботод очно.',
  ].join('\n');
}

export function resumedReply(code: string, found: boolean): string {
  return found
    ? `Чат #${code}: бот дахин асаалаа.`
    : `Чат #${code} олдсонгүй. Мэдэгдэл дээрх кодыг шалгана уу.`;
}

export function handoffAlert(input: {
  chatCode: string;
  reason?: string;
  lastMessage?: string;
  pauseHours: number;
}): string {
  return [
    `🔔 Хүн хэрэгтэй, чат #${input.chatCode}`,
    ...(input.reason ? [`Шалтгаан: ${clip(input.reason, 200)}`] : []),
    ...(input.lastMessage
      ? [`Сүүлийн мессеж: "${clip(input.lastMessage, 300)}"`]
      : []),
    `Page inbox-оос хариулна уу. Бот энэ чатад ${input.pauseHours} цаг чимээгүй байна; эрт асаах бол: /resume ${input.chatCode}`,
  ].join('\n');
}

export interface PaidOrderAlert {
  orderCode: string;
  total: number;
  items: { name: string; options: string[]; quantity: number }[];
  phone: string;
  address: string;
  note?: string;
}

export function paidOrderAlert(order: PaidOrderAlert): string {
  return [
    `🛒 Төлбөр төлөгдсөн захиалга #${order.orderCode}: ${formatMnt(order.total)}`,
    ...order.items.map(
      (item) =>
        `• ${item.name}${item.options.length ? ` (${item.options.join(', ')})` : ''} × ${item.quantity}`,
    ),
    `Утас: ${order.phone}`,
    `Хаяг: ${clip(order.address, 300)}`,
    ...(order.note ? [`Тайлбар: ${clip(order.note, 300)}`] : []),
  ].join('\n');
}

function clip(text: string, max: number): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}
