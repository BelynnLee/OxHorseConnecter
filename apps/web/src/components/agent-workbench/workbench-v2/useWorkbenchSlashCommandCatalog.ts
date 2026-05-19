import { useEffect, useState } from 'react';
import type { AgentWorkbenchApi } from './types.ts';
import type { SlashCommand } from '../../../types.ts';

export function useWorkbenchSlashCommandCatalog({
  api,
  selectedProvider,
  projectPath,
}: {
  api: AgentWorkbenchApi;
  selectedProvider?: string;
  projectPath: string;
}) {
  const [slashCommands, setSlashCommands] = useState<SlashCommand[]>([]);

  useEffect(() => {
    let cancelled = false;
    const timer = window.setTimeout(() => {
      void api
        .listSlashCommands({ provider: selectedProvider, projectPath })
        .then((commands) => {
          if (!cancelled) setSlashCommands(commands);
        })
        .catch(() => undefined);
    }, 300);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [api, projectPath, selectedProvider]);

  return { slashCommands, setSlashCommands };
}
