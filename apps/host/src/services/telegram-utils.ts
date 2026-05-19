import type { TelegramSource } from '@rac/shared';

const MARKDOWN_V2_SPECIALS = new Set(['_', '*', '[', ']', '(', ')', '~', '`', '>', '#', '+', '-', '=', '|', '{', '}', '.', '!', '\\']);

export function escapeMarkdownV2(text: string): string {
  return Array.from(text)
    .map((char) => (MARKDOWN_V2_SPECIALS.has(char) ? `\\${char}` : char))
    .join('');
}

export function chunkTelegramText(text: string, limit = 4096): string[] {
  const normalized = text.trim() || ' ';
  if (normalized.length <= limit) {
    return [normalized];
  }

  const chunks: string[] = [];
  let remaining = normalized;
  while (remaining.length > limit) {
    const window = remaining.slice(0, limit);
    const newline = window.lastIndexOf('\n');
    const space = window.lastIndexOf(' ');
    const splitAt = newline > limit * 0.55 ? newline : space > limit * 0.55 ? space : limit;
    chunks.push(remaining.slice(0, splitAt).trimEnd());
    remaining = remaining.slice(splitAt).trimStart();
  }
  if (remaining) {
    chunks.push(remaining);
  }
  return chunks;
}

export function normalizeTelegramCommand(text: string): { name: string; args: string } | undefined {
  const trimmed = text.trim();
  if (!trimmed.startsWith('/')) {
    return undefined;
  }
  const first = trimmed.split(/\s+/, 1)[0]?.slice(1) ?? '';
  if (!first) {
    return undefined;
  }
  const [name] = first.split('@');
  const args = trimmed.slice(first.length + 1).trim();
  return { name: name.toLowerCase(), args };
}

export function stripBotMention(text: string, botUsername: string | undefined): string {
  if (!botUsername) {
    return text.trim();
  }
  const escaped = botUsername.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return text
    .replace(new RegExp(`@${escaped}\\b`, 'gi'), '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function telegramActor(source: Pick<TelegramSource, 'username' | 'userId'>): string {
  return source.username ? `telegram:${source.username}` : `telegram:${source.userId ?? 'unknown'}`;
}

export function threadKeyFromId(threadId: number | string | undefined): string {
  if (threadId === undefined || threadId === null || String(threadId) === '1') {
    return '';
  }
  return String(threadId);
}

export function isRootThreadKey(threadKey: string): boolean {
  return threadKey === '' || threadKey === '1';
}
