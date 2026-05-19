export type CommandResultKind =
  | 'array'
  | 'object'
  | 'string'
  | 'number'
  | 'boolean'
  | 'null'
  | 'text';

export type CommandResultSummary = {
  parsed: boolean;
  value?: unknown;
  formatted: string;
  kind: CommandResultKind;
  lineCount: number;
  itemCount?: number;
  fieldCount?: number;
  preview: string;
  highlights: string[];
};

const interestingKeys = [
  'name',
  'title',
  'id',
  'status',
  'enabled',
  'auth_status',
  'type',
  'url',
  'provider',
  'model',
];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function lineCount(value: string): number {
  if (!value.trim()) return 0;
  return value.replace(/\n$/u, '').split(/\r?\n/u).length;
}

function truncate(value: string, maxLength = 160): string {
  const normalized = value.replace(/\s+/gu, ' ').trim();
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, maxLength - 3).trimEnd()}...`;
}

function kindOfJson(value: unknown): Exclude<CommandResultKind, 'text'> {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  if (isRecord(value)) return 'object';
  if (typeof value === 'string') return 'string';
  if (typeof value === 'number') return 'number';
  return 'boolean';
}

function displayValue(value: unknown): string {
  if (value === null) return 'null';
  if (typeof value === 'string') return truncate(value, 80);
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (Array.isArray(value)) return `${value.length} items`;
  if (isRecord(value)) return `${Object.keys(value).length} fields`;
  return truncate(String(value), 80);
}

function objectHighlights(value: Record<string, unknown>): string[] {
  const keys = Object.keys(value);
  const preferred = interestingKeys.filter((key) =>
    Object.prototype.hasOwnProperty.call(value, key)
  );
  const selected = (preferred.length ? preferred : keys).slice(0, 4);
  return selected.map((key) => `${key}: ${displayValue(value[key])}`);
}

function previewForJson(value: unknown): { preview: string; highlights: string[] } {
  if (Array.isArray(value)) {
    if (!value.length) return { preview: '', highlights: [] };
    const first = value[0];
    if (isRecord(first)) {
      const highlights = objectHighlights(first);
      return { preview: highlights.join(', '), highlights };
    }
    const preview = displayValue(first);
    return { preview, highlights: [preview] };
  }

  if (isRecord(value)) {
    const highlights = objectHighlights(value);
    return { preview: highlights.join(', '), highlights };
  }

  const preview = displayValue(value);
  return { preview, highlights: preview ? [preview] : [] };
}

export function summarizeCommandResult(content: string): CommandResultSummary {
  const trimmed = content.trim();
  if (!trimmed) {
    return {
      parsed: false,
      formatted: '',
      kind: 'text',
      lineCount: 0,
      preview: '',
      highlights: [],
    };
  }

  try {
    const value = JSON.parse(trimmed) as unknown;
    const formatted = JSON.stringify(value, null, 2);
    const kind = kindOfJson(value);
    const { preview, highlights } = previewForJson(value);
    return {
      parsed: true,
      value,
      formatted,
      kind,
      lineCount: lineCount(formatted),
      itemCount: Array.isArray(value) ? value.length : undefined,
      fieldCount: isRecord(value) ? Object.keys(value).length : undefined,
      preview,
      highlights,
    };
  } catch {
    return {
      parsed: false,
      formatted: content,
      kind: 'text',
      lineCount: lineCount(content),
      preview: truncate(trimmed),
      highlights: trimmed
        .split(/\r?\n/u)
        .map((line) => truncate(line, 100))
        .filter(Boolean)
        .slice(0, 3),
    };
  }
}
