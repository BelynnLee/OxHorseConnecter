import type {
  AgentWorkbenchApi,
  TimelineEvent,
  WorkbenchFileContent,
} from './types.ts';
import { contentFromPatch } from './workbenchPageUtils.ts';
import { useT } from '../../../i18n/index.ts';

export function useWorkbenchFileContent({
  api,
  apiSource,
  activeSessionId,
  eventsBySession,
}: {
  api: AgentWorkbenchApi;
  apiSource: 'real' | 'mock';
  activeSessionId?: string;
  eventsBySession: Record<string, TimelineEvent[]>;
}) {
  const { t } = useT();

  async function handleReadFileContent(filePath: string): Promise<WorkbenchFileContent> {
    if (!activeSessionId) {
      throw new Error(t.workbench.messages.sessionRequired);
    }

    if (apiSource === 'mock') {
      const fileEvent = [...(eventsBySession[activeSessionId] ?? [])]
        .reverse()
        .find((event) => event.type === 'file_diff_created' && event.filePath === filePath);
      if (!fileEvent || fileEvent.type !== 'file_diff_created') {
        throw new Error(t.workbench.v2.fileContentChangedOnly);
      }
      const content = fileEvent.changeType === 'deleted' ? '' : contentFromPatch(fileEvent.patch);
      return {
        path: filePath,
        exists: fileEvent.changeType !== 'deleted',
        content,
        sizeBytes: content.length,
        truncated: false,
        binary: false,
        updatedAt: fileEvent.timestamp,
      };
    }

    return api.getSessionFileContent(activeSessionId, filePath);
  }

  return { handleReadFileContent };
}
