import type { WorkbenchMode } from './types.ts';
import type { SlashCommand as BackendSlashCommand } from '../../../types.ts';
import type { Translations } from '../../../i18n/locales/en.ts';
import { classNames } from './utils.tsx';

export type SlashCommand = {
  id: string;
  label: string;
  insertText: string;
  mode?: WorkbenchMode;
  handler: BackendSlashCommand['handler'];
  description: string;
  source?: BackendSlashCommand['source'];
  provider?: BackendSlashCommand['provider'];
  degraded?: boolean;
  maturity?: BackendSlashCommand['maturity'];
};

const DESCRIPTION_KEYS: Record<string, string> = {
  'init-claude': 'initClaude',
  'wb:init-claude': 'initClaude',
};

function commandMode(command: BackendSlashCommand): WorkbenchMode | undefined {
  if (command.name === 'wb:plan') return 'plan';
  if (command.name === 'wb:review') return 'review';
  return undefined;
}

function commandInsertText(command: BackendSlashCommand): string {
  const label = `/${command.name}`;
  if (command.argsSchema || command.handler === 'agent-mode') {
    return `${label} `;
  }
  return label;
}

function commandDescription(command: BackendSlashCommand, t: Translations): string {
  const key = DESCRIPTION_KEYS[command.name] ?? command.name;
  const localized = (t.workbench.composer.commands as Record<string, string>)[key];
  return localized ?? command.description;
}

export function buildSlashCommands(commands: BackendSlashCommand[], t: Translations): SlashCommand[] {
  return commands
    .filter((command) => command.enabled)
    .map((command) => ({
      id: command.name,
      label: `/${command.name}`,
      insertText: commandInsertText(command),
      mode: commandMode(command),
      handler: command.handler,
      description: commandDescription(command, t),
      source: command.source,
      provider: command.provider,
      degraded: command.degraded,
      maturity: command.maturity,
    }));
}

type SlashCommandMenuProps = {
  query: string;
  commands: SlashCommand[];
  selectedIndex: number;
  onSelectedIndexChange: (index: number) => void;
  onPickCommand: (command: SlashCommand) => void;
};

export function filteredSlashCommands(query: string, commands: SlashCommand[]): SlashCommand[] {
  const normalized = query.replace(/^\//, '').trim().toLowerCase();
  if (!normalized) return commands;
  return commands.filter((command) => command.id.includes(normalized) || command.label.includes(normalized));
}

export function SlashCommandMenu({
  query,
  commands,
  selectedIndex,
  onSelectedIndexChange,
  onPickCommand,
}: SlashCommandMenuProps) {
  const filteredCommands = filteredSlashCommands(query, commands);

  if (!filteredCommands.length) return null;

  return (
    <div
      data-testid="slash-command-menu"
      className="absolute bottom-full left-0 right-0 z-20 mb-2 overflow-hidden rounded-sm border border-border-default bg-bg-surface-1 shadow-lg"
    >
      <div data-testid="slash-command-palette" className="max-h-64 overflow-y-auto p-1">
        {filteredCommands.map((command, index) => (
          <button
            key={command.id}
            type="button"
            onMouseEnter={() => onSelectedIndexChange(index)}
            onClick={() => onPickCommand(command)}
            className={classNames(
              'flex w-full items-start gap-3 rounded-xs px-3 py-2 text-left transition-colors',
              selectedIndex === index ? 'bg-accent/10 text-text-primary' : 'text-text-secondary hover:bg-bg-surface-2',
            )}
          >
            <span className="w-20 flex-shrink-0 font-mono text-xs text-accent">{command.label}</span>
            <span className="min-w-0 flex-1 text-xs text-text-tertiary">{command.description}</span>
            {command.source && (
              <span className="rounded-xs border border-border-subtle px-1.5 py-0.5 text-[10px] uppercase tracking-normal text-text-tertiary">
                {command.degraded ? 'degraded' : 'workbench'}
              </span>
            )}
          </button>
        ))}
      </div>
    </div>
  );
}
