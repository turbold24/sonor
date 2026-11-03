import type { Script } from '../common/mongolian-script.js';

// Messenger policy: an automated experience discloses itself at the start of a
// conversation, after a significant lapse, and when a chat moves from a person back to
// the bot. Sonor adds the note itself rather than trusting the model to.

export const DISCLOSURE_LAPSE_MS = 24 * 3_600_000;

export interface PastMessage {
  role: string;
  createdAt: Date;
}

/**
 * Whether the next bot reply must say it's automated. `history` is this conversation's
 * bot replies and owner messages, newest first.
 */
export function needsDisclosure(history: PastMessage[], now: Date): boolean {
  const lastReply = history.find((message) => message.role === 'AGENT');
  if (!lastReply) return true;
  if (now.getTime() - lastReply.createdAt.getTime() > DISCLOSURE_LAPSE_MS) {
    return true;
  }
  return history.some(
    (message) =>
      message.role === 'OWNER' && message.createdAt > lastReply.createdAt,
  );
}

export function disclosureNote(script: Script): string {
  return script === 'latin'
    ? 'Bi avtomat tuslah (bot). Ajiltantai yarih bol heleerei.'
    : 'Би автомат туслах (бот). Ажилтантай ярих бол хэлээрэй.';
}

export function withDisclosure(reply: string, script: Script): string {
  return `${reply}\n\n${disclosureNote(script)}`;
}
