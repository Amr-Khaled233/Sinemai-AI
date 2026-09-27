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
  'tool-findAlternatives': 'toolAlternatives',
  'tool-web_search': 'toolWeb',
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
  className,
}: {
  projectId: string;
  initialMessages: UIMessage[];
  hasSheet: boolean;
  className?: string;
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

  // When a sheet is ready and nothing has been said yet, the assistant opens the
  // conversation itself: what the script needs, the alternatives and where to save.
  const kickedOff = useRef(false);
  useEffect(() => {
    if (!hasSheet || initialMessages.length > 0 || kickedOff.current) return;
    kickedOff.current = true;
    void sendMessage({ text: t('kickoff') });
  }, [hasSheet, initialMessages.length, sendMessage, t]);

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
    <div className={cn('flex h-full min-h-[28rem] flex-col', className)}>
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

        {messages.map((message, messageIndex) => {
          const mine = message.role === 'user';
          // A question is open until the producer has said something after it.
          const answered = messages.slice(messageIndex + 1).some((later) => later.role === 'user');
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
                  if (part.type === 'tool-askUser') {
                    const input = 'input' in part ? (part.input as AskInput | undefined) : undefined;
                    if (!input?.question) return null;
                    return (
                      <AskCard
                        key={index}
                        input={input}
                        disabled={answered || busy}
                        onAnswer={send}
                        hint={t('askHint')}
                      />
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

type AskInput = { question: string; options?: string[]; why?: string };

/**
 * A question the assistant asked through its askUser tool: tap an answer, or
 * type one in the box below. Tapping sends the answer as the producer's next
 * message, so the conversation (and its stored history) reads naturally.
 */
function AskCard({
  input,
  disabled,
  onAnswer,
  hint,
}: {
  input: AskInput;
  disabled: boolean;
  onAnswer: (answer: string) => void;
  hint: string;
}) {
  return (
    <div className="rounded-md border border-accent/40 bg-accent/[0.06] p-3">
      <p className="flex items-start gap-2 text-sm font-medium text-strong" dir="auto">
        <span aria-hidden className="mt-0.5 grid size-5 shrink-0 place-items-center rounded-full bg-brass-500 text-[11px] font-bold text-ink-950">
          ?
        </span>
        {input.question}
      </p>
      {input.why && (
        <p className="mt-1 ps-7 text-[11px] text-muted" dir="auto">
          {input.why}
        </p>
      )}
      {(input.options?.length ?? 0) > 0 && (
        <div className="mt-2.5 flex flex-wrap gap-1.5 ps-7">
          {input.options!.map((option) => (
            <button
              key={option}
              type="button"
              className="chip text-xs"
              disabled={disabled}
              onClick={() => onAnswer(option)}
              dir="auto"
            >
              {option}
            </button>
          ))}
        </div>
      )}
      {!disabled && <p className="mt-2 ps-7 text-[11px] text-muted/80">{hint}</p>}
    </div>
  );
}
