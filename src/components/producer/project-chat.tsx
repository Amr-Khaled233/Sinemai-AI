'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useChat } from '@ai-sdk/react';
import { DefaultChatTransport, type UIMessage } from 'ai';
import { useLocale, useTranslations } from 'next-intl';
import { useRouter } from '@/i18n/routing';
import { Spinner } from '@/components/ui';
import { cn } from '@/lib/utils';

/** The tool names the assistant uses, mapped to the short status shown in the chat. */
const TOOL_LABELS: Record<string, string> = {
  'tool-getSheet': 'toolSheet',
  'tool-getScenes': 'toolScenes',
  'tool-searchCatalog': 'toolCatalog',
  'tool-updatePackage': 'toolUpdate',
};

/**
 * The project conversation. Only the newest message goes to the server, which
 * keeps the history; when the assistant changes the package the page refreshes
 * so the sheet beside the chat shows the new numbers.
 */
export function ProjectChat({
  projectId,
  initialMessages,
  hasSheet,
}: {
  projectId: string;
  initialMessages: UIMessage[];
  hasSheet: boolean;
}) {
  const t = useTranslations('chat');
  const locale = useLocale();
  const router = useRouter();
  const [input, setInput] = useState('');
  const scrollRef = useRef<HTMLDivElement>(null);

  const transport = useMemo(
    () =>
      new DefaultChatTransport({
        api: `/api/projects/${projectId}/chat`,
        prepareSendMessagesRequest: ({ messages }) => ({
          body: { message: messages[messages.length - 1], locale },
        }),
      }),
    [projectId, locale],
  );

  const { messages, sendMessage, status, stop, error } = useChat({
    id: `project-${projectId}`,
    messages: initialMessages,
    transport,
    onFinish: ({ message }) => {
      // A package edit re-priced the sheet on the server; show it.
      if (message.parts.some((part) => part.type === 'tool-updatePackage')) router.refresh();
    },
  });

  const busy = status === 'submitted' || status === 'streaming';

  useEffect(() => {
    const node = scrollRef.current;
    if (node) node.scrollTop = node.scrollHeight;
  }, [messages, status]);

  const send = (text: string) => {
    const value = text.trim();
    if (!value || busy) return;
    void sendMessage({ text: value });
    setInput('');
  };

  const suggestions = hasSheet
    ? [t('suggestWhy'), t('suggestCheaper'), t('suggestSecondCamera'), t('suggestNight')]
    : [t('suggestWhatNeeded'), t('suggestHowItWorks')];

  const errorMessage = error
    ? /AI_UNAVAILABLE/.test(error.message)
      ? t('unavailable')
      : /RATE_LIMITED|429/.test(error.message)
        ? t('rateLimited')
        : t('failed')
    : null;

  return (
    <div className="flex h-full min-h-[28rem] flex-col">
      <div ref={scrollRef} className="flex-1 space-y-4 overflow-y-auto p-4" aria-live="polite">
        {messages.length === 0 && (
          <div className="space-y-4 py-2">
            <p className="text-sm leading-7 text-muted">{hasSheet ? t('introWithSheet') : t('introNoSheet')}</p>
            <div className="flex flex-wrap gap-2">
              {suggestions.map((suggestion) => (
                <button key={suggestion} type="button" className="chip text-xs" onClick={() => send(suggestion)}>
                  {suggestion}
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map((message) => {
          const mine = message.role === 'user';
          return (
            <div key={message.id} className={cn('flex', mine ? 'justify-end' : 'justify-start')}>
              <div
                className={cn(
                  'max-w-[90%] space-y-2 rounded-lg px-3.5 py-2.5 text-sm leading-7',
                  mine ? 'bg-brass-500 text-ink-950' : 'border border-line bg-surface-sunken text-body',
                )}
              >
                {message.parts.map((part, index) => {
                  if (part.type === 'text') {
                    return (
                      <p key={index} className="whitespace-pre-wrap" dir="auto">
                        {part.text}
                      </p>
                    );
                  }
                  const label = TOOL_LABELS[part.type];
                  if (!label) return null;
                  const state = 'state' in part ? part.state : undefined;
                  const done = state === 'output-available';
                  const failed = state === 'output-error';
                  return (
                    <span
                      key={index}
                      className={cn(
                        'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[11px]',
                        failed ? 'border-danger/40 text-danger' : 'border-line text-muted',
                      )}
                    >
                      {!done && !failed && <Spinner className="size-3" />}
                      {done && <span aria-hidden>✓</span>}
                      {t(label)}
                    </span>
                  );
                })}
              </div>
            </div>
          );
        })}

        {status === 'submitted' && (
          <div className="flex justify-start">
            <span className="inline-flex items-center gap-2 rounded-lg border border-line bg-surface-sunken px-3.5 py-2.5 text-xs text-muted">
              <Spinner className="size-3.5" />
              {t('thinking')}
            </span>
          </div>
        )}

        {errorMessage && <p className="alert-danger text-xs">{errorMessage}</p>}
      </div>

      <form
        className="border-t border-line p-3"
        onSubmit={(event) => {
          event.preventDefault();
          send(input);
        }}
      >
        <div className="flex items-end gap-2">
          <textarea
            className="input max-h-40 min-h-[2.75rem] flex-1 resize-none py-2.5 text-sm"
            rows={1}
            dir="auto"
            value={input}
            placeholder={t('placeholder')}
            aria-label={t('placeholder')}
            onChange={(event) => setInput(event.target.value)}
            onKeyDown={(event) => {
              // Enter sends; Shift+Enter makes a new line.
              if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
                event.preventDefault();
                send(input);
              }
            }}
          />
          {busy ? (
            <button type="button" className="btn-secondary px-4 text-xs" onClick={() => stop()}>
              {t('stop')}
            </button>
          ) : (
            <button type="submit" className="btn-primary px-4 text-xs" disabled={!input.trim()}>
              {t('send')}
            </button>
          )}
        </div>
      </form>
    </div>
  );
}
