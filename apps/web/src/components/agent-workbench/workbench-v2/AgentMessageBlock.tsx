import { useT } from '../../../i18n/index.ts';
import type { MessageTimelineItem, ReasoningTimelineItem } from './types.ts';
import { CommandResultCard } from './CommandResultCard.tsx';
import { classNames, CopyTextButton, formatTime } from './utils.tsx';

type AgentMessageBlockProps = {
  item: MessageTimelineItem | ReasoningTimelineItem;
};

type MarkdownPart =
  | { type: 'text'; content: string }
  | { type: 'code'; content: string; language?: string };

function splitMarkdownParts(content: string): MarkdownPart[] {
  const parts: MarkdownPart[] = [];
  const fencePattern = /```([^\n`]*)\n?([\s\S]*?)```/g;
  let cursor = 0;
  let match: RegExpExecArray | null;

  while ((match = fencePattern.exec(content)) !== null) {
    if (match.index > cursor) {
      parts.push({ type: 'text', content: content.slice(cursor, match.index) });
    }
    parts.push({
      type: 'code',
      language: match[1]?.trim() || undefined,
      content: match[2]?.replace(/\n$/, '') ?? '',
    });
    cursor = match.index + match[0].length;
  }

  if (cursor < content.length) {
    parts.push({ type: 'text', content: content.slice(cursor) });
  }

  return parts.length > 0 ? parts : [{ type: 'text', content }];
}

function InlineMarkdown({ text }: { text: string }) {
  return (
    <>
      {text.split(/(`[^`]+`|\*\*[^*]+\*\*)/g).map((part, index) => {
        if (part.startsWith('`') && part.endsWith('`') && part.length > 1) {
          return (
            <code key={`${part}-${index}`} className="rounded-xs border border-border-soft bg-bg-app px-1 py-0.5 font-mono text-[0.92em] text-accent">
              {part.slice(1, -1)}
            </code>
          );
        }
        if (part.startsWith('**') && part.endsWith('**') && part.length > 4) {
          return <strong key={`${part}-${index}`} className="font-semibold text-text-primary">{part.slice(2, -2)}</strong>;
        }
        return <span key={`${part}-${index}`}>{part}</span>;
      })}
    </>
  );
}

function TextBlock({ content }: { content: string }) {
  const blocks = content.split(/\n{2,}/).map((block) => block.trim()).filter(Boolean);

  if (blocks.length === 0) return null;

  return (
    <div className="space-y-2">
      {blocks.map((block, index) => {
        const lines = block.split(/\n/);
        const listItems = lines
          .map((line) => line.match(/^\s*(?:[-*]|\d+\.)\s+(.+)$/)?.[1])
          .filter((line): line is string => Boolean(line));

        if (listItems.length === lines.length && listItems.length > 0) {
          return (
            <ul key={`${block}-${index}`} className="ml-4 list-disc space-y-1 text-[15px] leading-7">
              {listItems.map((line, itemIndex) => (
                <li key={`${line}-${itemIndex}`}>
                  <InlineMarkdown text={line} />
                </li>
              ))}
            </ul>
          );
        }

        const quoteItems = lines
          .map((line) => line.match(/^\s*>\s?(.+)$/)?.[1])
          .filter((line): line is string => Boolean(line));

        if (quoteItems.length === lines.length && quoteItems.length > 0) {
          return (
            <blockquote key={`${block}-${index}`} className="border-l-2 border-border-strong pl-3 text-[15px] leading-7 text-text-secondary">
              {quoteItems.map((line, itemIndex) => (
                <p key={`${line}-${itemIndex}`}><InlineMarkdown text={line} /></p>
              ))}
            </blockquote>
          );
        }

        return (
          <p key={`${block}-${index}`} className="whitespace-pre-wrap text-[15px] leading-7">
            <InlineMarkdown text={block} />
          </p>
        );
      })}
    </div>
  );
}

export function MarkdownBody({ content, lineCountLabel }: { content: string; lineCountLabel: (count: number) => string }) {
  return (
    <div className="space-y-3">
      {splitMarkdownParts(content).map((part, index) => {
        if (part.type === 'code') {
          return (
            <div key={`${part.language ?? 'code'}-${index}`} className="overflow-hidden rounded-sm border border-border-default bg-bg-app" data-testid="message-code-block">
              <div className="flex items-center justify-between border-b border-border-soft bg-bg-surface-2 px-3 py-1.5">
                <span className="font-mono text-[11px] uppercase text-text-tertiary">{part.language ?? 'code'}</span>
                <div className="flex items-center gap-2">
                  <span className="text-[11px] text-text-tertiary">{lineCountLabel(part.content.split(/\r?\n/).filter(Boolean).length)}</span>
                  <CopyTextButton text={part.content} dataTestId="message-copy-code" disabled={!part.content} />
                </div>
              </div>
              <pre className="overflow-auto p-3 font-mono text-xs leading-5 text-text-secondary">
                <code>{part.content || ' '}</code>
              </pre>
            </div>
          );
        }

        return <TextBlock key={`text-${index}`} content={part.content} />;
      })}
    </div>
  );
}

export function AgentMessageBlock({ item }: AgentMessageBlockProps) {
  const { t } = useT();

  if (item.type === 'reasoning') {
    return (
      <div className="rounded-sm border border-info/25 bg-info-soft px-3 py-2">
        <div className="mb-1 flex items-center justify-between gap-3">
          <span className="text-[11px] font-semibold uppercase text-info">{t.workbench.v2.progressSummary}</span>
          <span className="text-[11px] text-text-tertiary">{formatTime(item.timestamp)}</span>
        </div>
        <p className="whitespace-pre-wrap text-sm text-text-secondary">{item.event.content}</p>
      </div>
    );
  }

  const isUser = item.role === 'user';
  if (!isUser && item.messageKind === 'command_result') {
    return <CommandResultCard item={item} />;
  }

  const label = isUser ? t.workbench.v2.userTask : t.workbench.v2.assistantNarrative;

  return (
    <div className={classNames('flex', isUser ? 'justify-end' : 'justify-start')}>
      <div
        className={classNames(
          'min-w-0 px-4 py-3',
          isUser
            ? 'max-w-[82%] rounded-sm border border-accent/35 bg-accent/10 text-text-primary shadow-sm'
            : 'w-full max-w-[52rem] rounded-sm border border-border-default bg-bg-surface-1 text-text-primary shadow-md',
        )}
      >
        <div className="mb-1 flex items-center justify-between gap-3">
          <span className="text-[11px] font-semibold uppercase text-text-tertiary">{label}</span>
          <span className="text-[11px] text-text-tertiary">{formatTime(item.timestamp)}</span>
        </div>
        <div className={classNames(!isUser && 'text-text-primary')}>
          <MarkdownBody content={item.content} lineCountLabel={t.workbench.v2.lineCount} />
        </div>
      </div>
    </div>
  );
}
