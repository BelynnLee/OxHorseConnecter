import { randomUUID } from 'node:crypto';
import { ProjectRepository, RagRepository } from '@rac/storage';
import type { Project, RagHit, RagIndex, RagQueryResult } from '@rac/shared';
import { NotFoundError, BadRequestError } from './errors.js';
import type { RemoteWorkspaceClient, RemoteRagCollectResult } from './remote-workspace-client.js';

interface RagIndexResponse {
  indexedFiles?: number;
  indexedChunks?: number;
  status?: string;
  error?: string;
}

interface RagQueryResponse {
  chunks?: RagQueryResult['chunks'];
}

function endpoint(baseUrl: string, pathname: string): URL {
  return new URL(pathname, baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`);
}

async function postJson<T>(baseUrl: string, pathname: string, body: Record<string, unknown>): Promise<T> {
  const response = await fetch(endpoint(baseUrl, pathname), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  const payload = await response.json().catch(() => ({})) as Record<string, unknown>;
  if (!response.ok) {
    const detail = payload.detail;
    const message =
      (typeof payload.error === 'string' && payload.error.trim())
        ? payload.error.trim()
        : (typeof detail === 'string' && detail.trim())
          ? detail.trim()
          : detail
            ? JSON.stringify(detail)
            : undefined;
    throw new Error(message || `AI service returned ${response.status}.`);
  }
  return payload as T;
}

export class RagService {
  constructor(
    private projects: ProjectRepository,
    private rag: RagRepository,
    private aiServiceUrl: string,
    private hostDeviceId?: string,
    private remoteWorkspace?: RemoteWorkspaceClient,
  ) {}

  listIndexes(): RagIndex[] {
    return this.rag.listIndexes();
  }

  status(projectId: string): RagIndex | undefined {
    return this.rag.findIndexByProject(projectId);
  }

  private requireProject(projectId: string): Project {
    const project = this.projects.findById(projectId);
    if (!project) {
      throw new NotFoundError('Project not found.');
    }
    if (!project.enabled) {
      throw new BadRequestError('Project is disabled.');
    }
    return project;
  }

  resolveProject(
    projectId: string | undefined,
    workingDirectory: string | undefined,
    deviceId?: string,
  ): Project | undefined {
    if (projectId) {
      return this.projects.findById(projectId);
    }
    return workingDirectory && deviceId
      ? this.projects.findByDevicePath(deviceId, workingDirectory)
      : undefined;
  }

  async indexRepo(projectId: string): Promise<RagIndex> {
    const project = this.requireProject(projectId);
    const now = new Date().toISOString();
    const current = this.rag.findIndexByProject(projectId);
    const indexing: RagIndex = {
      id: current?.id ?? `rag-${randomUUID()}`,
      projectId,
      projectPath: project.path,
      status: 'indexing',
      indexedFiles: current?.indexedFiles ?? 0,
      indexedChunks: current?.indexedChunks ?? 0,
      createdAt: current?.createdAt ?? now,
      updatedAt: now,
    };
    this.rag.upsertIndex(indexing);

    try {
      const remote = Boolean(project.deviceId && this.hostDeviceId && project.deviceId !== this.hostDeviceId);
      let result: RagIndexResponse;
      if (remote) {
        if (!this.remoteWorkspace) {
          throw new Error('Remote workspace bridge is not configured.');
        }
        const collected = await this.remoteWorkspace.request<RemoteRagCollectResult>(
          project.deviceId,
          'rag_collect_chunks',
          { workDir: project.path },
          { timeoutMs: 60_000 }
        );
        result = await postJson<RagIndexResponse>(this.aiServiceUrl, '/rag/index-chunks', {
          projectId,
          chunks: collected.chunks,
        });
      } else {
        result = await postJson<RagIndexResponse>(this.aiServiceUrl, '/rag/index-repo', {
          projectId,
          path: project.path,
        });
      }
      const ready: RagIndex = {
        ...indexing,
        status: result.status === 'failed' ? 'failed' : 'ready',
        indexedFiles: result.indexedFiles ?? 0,
        indexedChunks: result.indexedChunks ?? 0,
        lastError: result.error,
        updatedAt: new Date().toISOString(),
      };
      this.rag.upsertIndex(ready);
      return ready;
    } catch (err) {
      const failed: RagIndex = {
        ...indexing,
        status: 'failed',
        lastError: err instanceof Error ? err.message : 'RAG indexing failed.',
        updatedAt: new Date().toISOString(),
      };
      this.rag.upsertIndex(failed);
      return failed;
    }
  }

  async query(input: {
    projectId: string;
    query: string;
    topK?: number;
    sessionId?: string;
  }): Promise<RagQueryResult> {
    const project = this.requireProject(input.projectId);
    const result = await postJson<RagQueryResponse>(this.aiServiceUrl, '/rag/query', {
      projectId: project.id,
      query: input.query,
      topK: input.topK ?? 6,
    });
    const chunks = result.chunks ?? [];
    const now = new Date().toISOString();
    const hits: RagHit[] = chunks.map((chunk) => ({
      id: `rag-hit-${randomUUID()}`,
      sessionId: input.sessionId,
      projectId: project.id,
      filePath: chunk.file,
      symbol: chunk.symbol,
      score: chunk.score,
      contentPreview: chunk.content.slice(0, 500),
      createdAt: now,
    }));
    if (hits.length > 0) {
      this.rag.recordHits(hits);
    }
    return { chunks };
  }

  async buildPromptContext(input: {
    projectId?: string;
    workingDirectory?: string;
    deviceId?: string;
    sessionId: string;
    query: string;
    topK?: number;
  }): Promise<string | undefined> {
    const project = this.resolveProject(input.projectId, input.workingDirectory, input.deviceId);
    if (!project?.enabled) {
      return undefined;
    }
    const result = await this.query({
      projectId: project.id,
      query: input.query,
      topK: input.topK,
      sessionId: input.sessionId,
    });
    if (result.chunks.length === 0) {
      return undefined;
    }

    const snippets = result.chunks.map((chunk, index) => {
      const location = chunk.symbol ? `${chunk.file}#${chunk.symbol}` : chunk.file;
      return `### RAG ${index + 1}: ${location} (score ${chunk.score.toFixed(3)})\n${chunk.content}`;
    });

    return [
      'Relevant repository context retrieved by the CodeAgent Control Plane RAG index:',
      ...snippets,
      'Use the retrieved context when it is relevant, and verify against the working tree before editing.',
    ].join('\n\n');
  }

  async deleteIndex(projectId: string): Promise<void> {
    await postJson(this.aiServiceUrl, '/rag/delete-index', { projectId }).catch(() => undefined);
    this.rag.deleteIndex(projectId);
  }

  hits(filter?: { sessionId?: string; projectId?: string; limit?: number }): RagHit[] {
    return this.rag.findHits(filter);
  }
}
