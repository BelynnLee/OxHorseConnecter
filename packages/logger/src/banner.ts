/**
 * Human-readable startup banner helpers — printed once during boot.
 * Goes directly to stderr so it isn't mixed with stdout payloads, and
 * respects NO_COLOR / non-TTY contexts.
 */

const ESC = '\x1b[';
const RESET = `${ESC}0m`;
const BOLD = `${ESC}1m`;

const FG = {
  gray: `${ESC}90m`,
  red: `${ESC}31m`,
  green: `${ESC}32m`,
  yellow: `${ESC}33m`,
  blue: `${ESC}34m`,
  magenta: `${ESC}35m`,
  cyan: `${ESC}36m`,
  white: `${ESC}37m`,
} as const;

function colorEnabled(): boolean {
  if (process.env.NO_COLOR) return false;
  if (process.env.FORCE_COLOR && process.env.FORCE_COLOR !== '0') return true;
  return process.stderr.isTTY === true;
}

function paint(text: string, color: string): string {
  return colorEnabled() ? `${color}${text}${RESET}` : text;
}

function write(line: string): void {
  process.stderr.write(line + '\n');
}

export function divider(width = 60): void {
  write(paint('─'.repeat(width), FG.gray));
}

/**
 * Top banner with title and optional subtitle. Use once at boot.
 */
export function banner(title: string, subtitle?: string): void {
  write('');
  const titlePart = colorEnabled()
    ? `${BOLD}${FG.cyan}${title}${RESET}`
    : title;
  const subtitlePart = subtitle ? `  ${paint(subtitle, FG.gray)}` : '';
  write(`  ${titlePart}${subtitlePart}`);
  divider();
}

/**
 * Section header. Pair with item() lines underneath.
 */
export function section(label: string): void {
  write('');
  write(paint(`▸ ${label}`, FG.cyan));
}

export type ItemStatus = 'ok' | 'warn' | 'error' | 'skip' | 'info';

const STATUS_GLYPH: Record<ItemStatus, string> = {
  ok: '✓',
  warn: '⚠',
  error: '✗',
  skip: '·',
  info: '•',
};

const STATUS_COLOR: Record<ItemStatus, string> = {
  ok: FG.green,
  warn: FG.yellow,
  error: FG.red,
  skip: FG.gray,
  info: FG.blue,
};

const LABEL_WIDTH = 18;

const OX_HORSE_CONNECTER_ART = [
  ' ██████╗ ██╗  ██╗██╗  ██╗ ██████╗ ██████╗ ███████╗███████╗',
  '██╔═══██╗╚██╗██╔╝██║  ██║██╔═══██╗██╔══██╗██╔════╝██╔════╝',
  '██║   ██║ ╚███╔╝ ███████║██║   ██║██████╔╝███████╗█████╗  ',
  '██║   ██║ ██╔██╗ ██╔══██║██║   ██║██╔══██╗╚════██║██╔══╝  ',
  '╚██████╔╝██╔╝ ██╗██║  ██║╚██████╔╝██║  ██║███████║███████╗',
  ' ╚═════╝ ╚═╝  ╚═╝╚═╝  ╚═╝ ╚═════╝ ╚═╝  ╚═╝╚══════╝╚══════╝',
  '',
  ' ██████╗ ██████╗ ███╗   ██╗███╗   ██╗███████╗ ██████╗████████╗███████╗██████╗ ',
  '██╔════╝██╔═══██╗████╗  ██║████╗  ██║██╔════╝██╔════╝╚══██╔══╝██╔════╝██╔══██╗',
  '██║     ██║   ██║██╔██╗ ██║██╔██╗ ██║█████╗  ██║        ██║   █████╗  ██████╔╝',
  '██║     ██║   ██║██║╚██╗██║██║╚██╗██║██╔══╝  ██║        ██║   ██╔══╝  ██╔══██╗',
  '╚██████╗╚██████╔╝██║ ╚████║██║ ╚████║███████╗╚██████╗   ██║   ███████╗██║  ██║',
  ' ╚═════╝ ╚═════╝ ╚═╝  ╚═══╝╚═╝  ╚═══╝╚══════╝ ╚═════╝   ╚═╝   ╚══════╝╚═╝  ╚═╝',
];

const LOGO_GOLD = `${ESC}38;2;241;221;223m`;
const LOGO_SHADOW = `${ESC}38;2;188;161;166m`;
const LOGO_DIM = `${ESC}38;2;128;112;116m`;
const LOGO_PINK = `${ESC}38;2;231;45;72m`;
const LOGO_PINK_SHADOW = `${ESC}38;2;166;32;52m`;
const LOGO_PINK_DIM = `${ESC}38;2;122;38;51m`;
const LOGO_SHADOW_CHARS = new Set(['╔', '╗', '╚', '╝', '═', '║']);

function isPinkLogoZone(lineIndex: number, columnIndex: number): boolean {
  if (lineIndex <= 5) {
    return (columnIndex >= 0 && columnIndex <= 7) || (columnIndex >= 17 && columnIndex <= 24);
  }

  return lineIndex >= 7;
}

function paintInlineBrand(): string {
  if (!colorEnabled()) return 'OxHorseConnecter';
  return `${BOLD}${LOGO_PINK}O${LOGO_GOLD}x${LOGO_PINK}H${LOGO_GOLD}orse${LOGO_PINK}Connecter${RESET}`;
}

function paintLogoLine(line: string, lineIndex: number): string {
  if (!colorEnabled()) return line;

  let output = '';
  let active = '';

  const chars = Array.from(line);
  for (let columnIndex = 0; columnIndex < chars.length; columnIndex += 1) {
    const char = chars[columnIndex] ?? '';
    const isPink = isPinkLogoZone(lineIndex, columnIndex);
    const next = char === '█'
      ? isPink ? LOGO_PINK : LOGO_GOLD
      : LOGO_SHADOW_CHARS.has(char)
        ? isPink ? LOGO_PINK_SHADOW : LOGO_SHADOW
        : char.trim()
          ? isPink ? LOGO_PINK_DIM : LOGO_DIM
          : '';
    if (next !== active) {
      if (active) output += RESET;
      if (next) output += next;
      active = next;
    }
    output += char;
  }

  return active ? `${output}${RESET}` : output;
}

/**
 * Compatibility brand mark for launch output. It intentionally keeps the
 * historical package names and runtime identifiers unchanged.
 */
export function oxHorseConnecterLogo(subtitle?: string): void {
  write('');
  for (const [lineIndex, artLine] of OX_HORSE_CONNECTER_ART.entries()) {
    write(`  ${paintLogoLine(artLine, lineIndex)}`);
  }

  const prompt = colorEnabled() ? `${LOGO_GOLD}$${RESET}` : '$';
  const brand = paintInlineBrand();
  const subtitlePart = subtitle ? `  ${paint(subtitle, FG.gray)}` : '';
  write(`  ${prompt} ${brand}${subtitlePart}`);
  divider(82);
}

/**
 * Item line under a section. Format: `  ✓ Database          data/rac.db`
 */
export function item(status: ItemStatus, label: string, detail?: string): void {
  const glyph = paint(STATUS_GLYPH[status], STATUS_COLOR[status]);
  const padded = label.padEnd(LABEL_WIDTH, ' ');
  const labelColor = status === 'skip' ? FG.gray : FG.white;
  const detailColor = status === 'skip' ? FG.gray : FG.white;
  const detailText = detail ? `  ${paint(detail, detailColor)}` : '';
  write(`  ${glyph} ${paint(padded, labelColor)}${detailText}`);
}

/**
 * Free-form line at section indent without a status glyph.
 */
export function line(text: string, color: keyof typeof FG = 'white'): void {
  write(`    ${paint(text, FG[color])}`);
}
