import pino, { type Logger as PinoLogger, type LoggerOptions as PinoLoggerOptions } from 'pino';

export type Logger = PinoLogger;

export interface LoggerOptions {
  /** Component name surfaced in pretty output and as `name` in JSON. */
  name?: string;
  /** Minimum level. Defaults to LOG_LEVEL env or 'info'. */
  level?: pino.LevelWithSilent;
  /** Force pretty/JSON; defaults to pretty when stderr is a TTY. */
  pretty?: boolean;
}

let rootLogger: PinoLogger | undefined;
const PRETTY_TRANSLATE_TIME = 'SYS:HH:MM:ss';

function pad(value: number, length = 2): string {
  return String(value).padStart(length, '0');
}

function formatLocalIsoTime(date: Date): string {
  const offsetMinutes = -date.getTimezoneOffset();
  const sign = offsetMinutes >= 0 ? '+' : '-';
  const absoluteOffset = Math.abs(offsetMinutes);
  const offsetHours = Math.trunc(absoluteOffset / 60);
  const offsetRemainder = absoluteOffset % 60;

  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(
    date.getHours(),
  )}:${pad(date.getMinutes())}:${pad(date.getSeconds())}.${pad(
    date.getMilliseconds(),
    3,
  )}${sign}${pad(offsetHours)}:${pad(offsetRemainder)}`;
}

function localIsoTime(): string {
  return `,"time":"${formatLocalIsoTime(new Date())}"`;
}

function envBool(value: string | undefined): boolean | undefined {
  if (value == null) return undefined;
  return ['1', 'true', 'yes', 'on'].includes(value.trim().toLowerCase());
}

function resolveLevel(): pino.LevelWithSilent {
  const raw = process.env.LOG_LEVEL?.trim().toLowerCase();
  const allowed: pino.LevelWithSilent[] = ['trace', 'debug', 'info', 'warn', 'error', 'fatal', 'silent'];
  if (raw && (allowed as string[]).includes(raw)) {
    return raw as pino.LevelWithSilent;
  }
  return 'info';
}

function resolvePretty(): boolean {
  const explicit = envBool(process.env.LOG_PRETTY);
  if (explicit != null) return explicit;
  if (process.env.LOG_FORMAT?.toLowerCase() === 'json') return false;
  return process.stderr.isTTY === true;
}

function getRootLogger(): PinoLogger {
  if (rootLogger) return rootLogger;

  const level = resolveLevel();
  const pretty = resolvePretty();

  const baseOptions: PinoLoggerOptions = {
    level,
    base: undefined,
    timestamp: localIsoTime,
    formatters: {
      level: (label) => ({ level: label }),
    },
  };

  if (pretty) {
    rootLogger = pino({
      ...baseOptions,
      transport: {
        target: 'pino-pretty',
        options: {
          colorize: true,
          singleLine: true,
          translateTime: PRETTY_TRANSLATE_TIME,
          ignore: 'pid,hostname',
          messageFormat: '{if name}[{name}] {end}{msg}',
        },
      },
    });
  } else {
    rootLogger = pino(baseOptions);
  }

  return rootLogger;
}

export function createLogger(nameOrOptions?: string | LoggerOptions): Logger {
  const options: LoggerOptions =
    typeof nameOrOptions === 'string' ? { name: nameOrOptions } : nameOrOptions ?? {};

  const root = getRootLogger();
  if (!options.name) {
    return options.level ? root.child({}, { level: options.level }) : root;
  }

  return root.child(
    { name: options.name },
    options.level ? { level: options.level } : undefined,
  );
}

export const __test = {
  formatLocalIsoTime,
  prettyTranslateTime: PRETTY_TRANSLATE_TIME,
};
