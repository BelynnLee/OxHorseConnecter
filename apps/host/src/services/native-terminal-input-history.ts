const MAX_HISTORY_BYTES = 256 * 1024;
const MIRRORED_TERMINAL_SLASH_COMMANDS = new Set(['fast', 'model', 'permissions']);

export interface TerminalInputMirrorSession {
  linkedSessionId?: string;
  inputBuffer: string;
}

export function appendTerminalHistory(
  current: string,
  next: string,
  maxBytes = MAX_HISTORY_BYTES
): string {
  const combined = current + next;
  if (Buffer.byteLength(combined, 'utf8') <= maxBytes) {
    return combined;
  }
  return combined.slice(Math.max(0, combined.length - maxBytes));
}

export function stripTerminalInputControls(value: string): string {
  // eslint-disable-next-line no-control-regex
  return value.replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, '');
}

export function slashCommandName(line: string): string | undefined {
  const trimmed = line.trim();
  if (!trimmed.startsWith('/')) return undefined;
  const body = trimmed.slice(1);
  const firstSpace = body.search(/\s/);
  const name = firstSpace === -1 ? body : body.slice(0, firstSpace);
  return name.toLowerCase();
}

export function shouldMirrorTerminalSlashCommand(line: string): boolean {
  const command = slashCommandName(line);
  return Boolean(command && MIRRORED_TERMINAL_SLASH_COMMANDS.has(command));
}

export function recordTerminalInputLines(
  session: TerminalInputMirrorSession,
  data: string
): string[] {
  const lines: string[] = [];
  for (const char of stripTerminalInputControls(data)) {
    if (char === '\r' || char === '\n') {
      const line = session.inputBuffer.trim();
      session.inputBuffer = '';
      if (line) lines.push(line);
      continue;
    }

    if (char === '\b' || char === '\x7f') {
      session.inputBuffer = session.inputBuffer.slice(0, -1);
      continue;
    }

    if (char === '\x03' || char === '\x15') {
      session.inputBuffer = '';
      continue;
    }

    if (char >= ' ' && char !== '\x7f') {
      session.inputBuffer = `${session.inputBuffer}${char}`.slice(-1000);
    }
  }
  return lines;
}
