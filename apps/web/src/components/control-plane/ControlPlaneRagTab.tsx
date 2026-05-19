import type { Dispatch, FormEvent, SetStateAction } from 'react';
import { DatabaseZap, Loader2, Search, Trash2 } from 'lucide-react';
import type { Project, RagHit, RagIndex, RagQueryResult } from '../../types.ts';
import { useT } from '../../i18n/index.ts';
import { formatDateTime } from '../../lib/format.ts';
import { Badge } from '../ui/Badge.tsx';
import { Button } from '../ui/Button.tsx';
import { Input } from '../ui/Input.tsx';
import { SurfaceItem } from '../ui/SurfaceItem.tsx';
import {
  ControlPlaneField,
  ControlPlaneSection,
  mappedLabel,
  statusTone,
} from './ControlPlaneCommon.tsx';

type RagForm = {
  projectId: string;
  query: string;
  topK: string;
};

export function ControlPlaneRagTab({
  enabledProjects,
  ragForm,
  ragIndexByProject,
  ragResult,
  ragHits,
  busy,
  onRagFormChange,
  onIndex,
  onDelete,
  onQuery,
}: {
  enabledProjects: Project[];
  ragForm: RagForm;
  ragIndexByProject: Map<string, RagIndex>;
  ragResult?: RagQueryResult;
  ragHits: RagHit[];
  busy: string;
  onRagFormChange: Dispatch<SetStateAction<RagForm>>;
  onIndex: () => void;
  onDelete: () => void;
  onQuery: (event: FormEvent<HTMLFormElement>) => void;
}) {
  const { t } = useT();
  const cp = t.controlPlane;
  const selectedIndex = ragForm.projectId ? ragIndexByProject.get(ragForm.projectId) : undefined;

  return (
    <div className="grid gap-4 xl:grid-cols-[420px_minmax(0,1fr)]">
      <ControlPlaneSection title={cp.sections.repositoryIndex} icon={DatabaseZap}>
        <div className="space-y-3">
          <ControlPlaneField label={cp.fields.project}>
            <select
              className="input-base"
              value={ragForm.projectId}
              onChange={(event) => onRagFormChange({ ...ragForm, projectId: event.target.value })}
            >
              <option value="">{cp.options.selectProject}</option>
              {enabledProjects.map((project) => (
                <option key={project.id} value={project.id}>
                  {project.name}
                </option>
              ))}
            </select>
          </ControlPlaneField>
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="primary"
              disabled={!ragForm.projectId || busy === 'rag-index'}
              onClick={onIndex}
            >
              {busy === 'rag-index' ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <DatabaseZap className="h-4 w-4" />
              )}
              {cp.actions.index}
            </Button>
            <Button
              type="button"
              variant="danger"
              disabled={!ragForm.projectId || busy === 'rag-delete'}
              onClick={onDelete}
            >
              <Trash2 className="h-4 w-4" />
              {t.delete}
            </Button>
          </div>
          {selectedIndex && (
            <div className="rounded-sm border border-border-soft bg-bg-app p-3 text-sm text-text-secondary">
              <div className="space-y-1">
                <Badge tone={statusTone(selectedIndex.status)}>
                  {mappedLabel(cp.statusLabels, selectedIndex.status)}
                </Badge>
                <p>{cp.rag.indexed(selectedIndex.indexedFiles, selectedIndex.indexedChunks)}</p>
                <p className="text-xs text-text-tertiary">
                  {formatDateTime(selectedIndex.updatedAt)}
                </p>
                {selectedIndex.lastError && (
                  <p className="text-danger">{selectedIndex.lastError}</p>
                )}
              </div>
            </div>
          )}
        </div>
      </ControlPlaneSection>

      <ControlPlaneSection title={cp.sections.query} icon={Search}>
        <form className="mb-4 grid gap-3 lg:grid-cols-[1fr_90px_auto]" onSubmit={onQuery}>
          <Input
            value={ragForm.query}
            onChange={(event) => onRagFormChange({ ...ragForm, query: event.target.value })}
            placeholder={cp.placeholders.searchRepositoryContext}
          />
          <Input
            value={ragForm.topK}
            inputMode="numeric"
            onChange={(event) => onRagFormChange({ ...ragForm, topK: event.target.value })}
          />
          <Button
            type="submit"
            variant="primary"
            disabled={!ragForm.projectId || !ragForm.query.trim() || busy === 'rag-query'}
          >
            {busy === 'rag-query' ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Search className="h-4 w-4" />
            )}
            {cp.actions.query}
          </Button>
        </form>

        <div className="space-y-3">
          {(ragResult?.chunks ?? []).map((chunk, index) => (
            <div
              key={`${chunk.file}-${index}`}
              className="rounded-sm border border-border-soft bg-bg-app p-3"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="break-all font-mono text-xs text-text-primary">
                  {chunk.file}
                  {chunk.symbol ? `#${chunk.symbol}` : ''}
                </p>
                <Badge tone="info">{chunk.score.toFixed(3)}</Badge>
              </div>
              <pre className="mt-2 max-h-44 overflow-auto whitespace-pre-wrap text-xs text-text-secondary">
                {chunk.content}
              </pre>
            </div>
          ))}
          {ragResult && ragResult.chunks.length === 0 && (
            <p className="text-sm text-text-tertiary">{cp.empty.noChunks}</p>
          )}
        </div>

        <div className="mt-5 border-t border-border-soft pt-4">
          <p className="mb-2 text-xs font-semibold uppercase tracking-[0.08em] text-text-tertiary">
            {cp.sections.recentHits}
          </p>
          <div className="space-y-2">
            {ragHits.slice(0, 8).map((hit) => (
              <SurfaceItem key={hit.id}>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="break-all font-mono text-xs text-text-primary">{hit.filePath}</p>
                  <span className="text-xs text-text-tertiary">{hit.score.toFixed(3)}</span>
                </div>
                <p className="mt-1 line-clamp-2 text-xs text-text-secondary">
                  {hit.contentPreview}
                </p>
              </SurfaceItem>
            ))}
            {ragHits.length === 0 && (
              <p className="text-sm text-text-tertiary">{cp.empty.noHits}</p>
            )}
          </div>
        </div>
      </ControlPlaneSection>
    </div>
  );
}
