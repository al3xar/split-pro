import { TRPCClientError } from '@trpc/client';
import {
  CheckIcon,
  ChevronLeftIcon,
  MessageSquarePlusIcon,
  ReceiptTextIcon,
  SendIcon,
  SparklesIcon,
  Trash2Icon,
  XIcon,
} from 'lucide-react';
import Head from 'next/head';
import Link from 'next/link';
import { useRouter } from 'next/router';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';

import MainLayout from '~/components/Layout/MainLayout';
import { Button } from '~/components/ui/button';
import { CategoryIcon } from '~/components/ui/categoryIcons';
import { Textarea } from '~/components/ui/textarea';
import { getTimeZone } from '~/hooks/useMonthParam';
import { useTranslationWithUtils } from '~/hooks/useTranslationWithUtils';
import { cn } from '~/lib/utils';
import { useAddExpenseDialog } from '~/store/addExpenseDialogStore';
import { type NextPageWithUser } from '~/types';
import { type RouterOutputs, api } from '~/utils/api';
import { withI18nStaticProps } from '~/utils/i18n/server';

type DisplayMessage = RouterOutputs['assistant']['messages'][number];

/** Tiny, safe markdown: **bold**, "- " bullets and line breaks, rendered as React nodes. */
const RichText: React.FC<{ text: string }> = ({ text }) => {
  const lines = text.split('\n');
  const bold = (line: string) =>
    line
      .split(/(\*\*[^*]+\*\*)/g)
      .map((part, i) =>
        part.startsWith('**') && part.endsWith('**') ? (
          <strong key={i}>{part.slice(2, -2)}</strong>
        ) : (
          <React.Fragment key={i}>{part}</React.Fragment>
        ),
      );
  return (
    <div className="flex flex-col gap-1">
      {lines.map((line, i) =>
        /^\s*[-*]\s+/.test(line) ? (
          <p key={i} className="flex gap-2">
            <span aria-hidden>•</span>
            <span>{bold(line.replace(/^\s*[-*]\s+/, ''))}</span>
          </p>
        ) : '' === line.trim() ? (
          <span key={i} className="h-1" />
        ) : (
          <p key={i}>{bold(line)}</p>
        ),
      )}
    </div>
  );
};

const ProposalCard: React.FC<{
  message: DisplayMessage;
  onDecision: (messageId: number, saved: boolean, expenseId?: string) => void;
}> = ({ message, onDecision }) => {
  const { t, toUIDate, getCurrencyHelpersCached } = useTranslationWithUtils();
  const openWith = useAddExpenseDialog((s) => s.openWith);
  const proposal = message.proposal!;
  const prefill = proposal.prefill as {
    groupId?: number;
    name: string;
    amount: string;
    currency: string;
    category: string;
    paidById?: number;
    expenseDate: string;
  };
  const amount = BigInt(prefill.amount);

  const review = () =>
    openWith({
      groupId: prefill.groupId,
      name: prefill.name,
      amount,
      currency: prefill.currency,
      category: prefill.category,
      paidById: prefill.paidById,
      expenseDate: new Date(prefill.expenseDate),
      onSaved: (expenseId) => onDecision(message.id, true, expenseId),
      onCancel: () => onDecision(message.id, false),
    });

  return (
    <div className="bg-card flex flex-col gap-3 rounded-xl border p-3">
      <div className="flex items-center gap-3">
        <CategoryIcon category={prefill.category} size={20} className="text-muted-foreground" />
        <div className="min-w-0 flex-1">
          <p className="truncate font-medium">{prefill.name}</p>
          <p className="text-muted-foreground text-xs">{toUIDate(new Date(prefill.expenseDate))}</p>
        </div>
        <span className="font-semibold tabular-nums">
          {getCurrencyHelpersCached(prefill.currency).toUIString(amount)}
        </span>
      </div>
      {'pending' === proposal.status ? (
        <Button className="h-11" onClick={review}>
          <ReceiptTextIcon className="mr-2 size-4" aria-hidden />
          {t('assistant.review_expense')}
        </Button>
      ) : (
        <p
          className={cn(
            'flex items-center gap-1 text-sm',
            'saved' === proposal.status ? 'text-positive' : 'text-muted-foreground',
          )}
        >
          {'saved' === proposal.status ? (
            <CheckIcon className="size-4" aria-hidden />
          ) : (
            <XIcon className="size-4" aria-hidden />
          )}
          {t(`assistant.proposal_${proposal.status}`)}
        </p>
      )}
    </div>
  );
};

const SUGGESTIONS = ['spent_month', 'pending_food', 'add_dinner', 'top_categories'] as const;

const AssistantPage: NextPageWithUser = () => {
  const { t } = useTranslationWithUtils();
  const router = useRouter();
  const conversationId = 'string' === typeof router.query.c ? router.query.c : undefined;
  const [text, setText] = useState('');
  const [pendingText, setPendingText] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const timeZone = useMemo(getTimeZone, []);

  const enabledQuery = api.assistant.enabled.useQuery();
  const conversationsQuery = api.assistant.conversations.useQuery(undefined, {
    enabled: Boolean(enabledQuery.data),
  });
  const messagesQuery = api.assistant.messages.useQuery(
    { conversationId: conversationId ?? '' },
    { enabled: Boolean(conversationId) },
  );
  const sendMutation = api.assistant.send.useMutation();
  const proposalMutation = api.assistant.proposalResult.useMutation();
  const deleteMutation = api.assistant.delete.useMutation();
  const apiUtils = api.useUtils();

  const messages = useMemo(
    () => (conversationId ? (messagesQuery.data ?? []) : []),
    [conversationId, messagesQuery.data],
  );

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [messages.length, pendingText]);

  const setConversation = useCallback(
    (id?: string) => {
      router
        .replace({ pathname: router.pathname, query: id ? { c: id } : {} }, undefined, {
          shallow: true,
        })
        .catch(console.error);
    },
    [router],
  );

  const send = useCallback(
    async (value: string) => {
      const trimmed = value.trim();
      if (!trimmed || sendMutation.isPending) {
        return;
      }
      setText('');
      setPendingText(trimmed);
      try {
        const result = await sendMutation.mutateAsync({ conversationId, text: trimmed, timeZone });
        if (result.conversationId !== conversationId) {
          setConversation(result.conversationId);
        }
        await apiUtils.assistant.invalidate();
      } catch (error) {
        const code = error instanceof TRPCClientError ? error.message : '';
        toast.error('LLM_UNAVAILABLE' === code ? t('assistant.unavailable') : t('assistant.error'));
        setText(trimmed);
      } finally {
        setPendingText(null);
      }
    },
    [sendMutation, conversationId, timeZone, setConversation, apiUtils, t],
  );

  const onDecision = useCallback(
    (messageId: number, saved: boolean, expenseId?: string) => {
      proposalMutation
        .mutateAsync({ messageId, saved, expenseId })
        .then(() => apiUtils.assistant.messages.invalidate())
        .catch(console.error);
    },
    [proposalMutation, apiUtils],
  );

  const remove = useCallback(async () => {
    if (!conversationId) {
      return;
    }
    await deleteMutation.mutateAsync({ conversationId });
    setConversation(undefined);
    await apiUtils.assistant.conversations.invalidate();
  }, [conversationId, deleteMutation, setConversation, apiUtils]);

  const header = (
    <div className="flex items-center gap-1">
      <Button variant="ghost" size="icon" className="size-11" asChild>
        <Link href="/household" aria-label={t('navigation.household')}>
          <ChevronLeftIcon className="size-6" aria-hidden />
        </Link>
      </Button>
      <h1 className="text-xl font-semibold">{t('assistant.title')}</h1>
    </div>
  );

  if (enabledQuery.isSuccess && !enabledQuery.data) {
    return (
      <MainLayout title={header}>
        <div className="bg-card rounded-xl border p-6 text-center">
          <p className="font-semibold">{t('assistant.disabled_title')}</p>
          <p className="text-muted-foreground mt-1 text-sm">{t('assistant.disabled_body')}</p>
        </div>
      </MainLayout>
    );
  }

  return (
    <>
      <Head>
        <title>{t('assistant.title')}</title>
      </Head>
      <MainLayout
        title={header}
        actions={
          <div className="flex gap-1">
            {conversationId ? (
              <Button
                variant="ghost"
                size="icon"
                className="size-11"
                aria-label={t('assistant.delete')}
                onClick={() => void remove()}
              >
                <Trash2Icon className="size-5" aria-hidden />
              </Button>
            ) : null}
            <Button
              variant="ghost"
              size="icon"
              className="size-11"
              aria-label={t('assistant.new')}
              onClick={() => setConversation(undefined)}
            >
              <MessageSquarePlusIcon className="size-5" aria-hidden />
            </Button>
          </div>
        }
      >
        <div className="flex flex-col gap-4 pb-40">
          {conversationsQuery.data?.length ? (
            <nav
              aria-label={t('assistant.conversations')}
              className="flex gap-2 overflow-x-auto pb-1"
            >
              {conversationsQuery.data.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => setConversation(c.id)}
                  aria-current={c.id === conversationId ? 'page' : undefined}
                  className={cn(
                    'min-h-10 max-w-52 shrink-0 truncate rounded-full border px-3 text-sm',
                    c.id === conversationId
                      ? 'border-primary bg-primary/15 font-medium'
                      : 'text-muted-foreground',
                  )}
                >
                  {c.title || t('assistant.untitled')}
                </button>
              ))}
            </nav>
          ) : null}

          {0 === messages.length && !pendingText ? (
            <section className="bg-card flex flex-col items-center gap-3 rounded-xl border p-6 text-center">
              <SparklesIcon className="text-primary size-8" aria-hidden />
              <p className="font-semibold">{t('assistant.welcome_title')}</p>
              <p className="text-muted-foreground text-sm">{t('assistant.welcome_body')}</p>
              <div className="flex flex-wrap justify-center gap-2">
                {SUGGESTIONS.map((key) => (
                  <Button
                    key={key}
                    variant="outline"
                    className="h-auto min-h-11 rounded-full text-left whitespace-normal"
                    onClick={() => void send(t(`assistant.suggestions.${key}`))}
                  >
                    {t(`assistant.suggestions.${key}`)}
                  </Button>
                ))}
              </div>
            </section>
          ) : null}

          <ol className="flex flex-col gap-3" aria-live="polite">
            {messages.map((m) =>
              m.proposal ? (
                <li key={m.id} className="max-w-[85%] self-start">
                  <ProposalCard message={m} onDecision={onDecision} />
                </li>
              ) : (
                <li
                  key={m.id}
                  className={cn(
                    'max-w-[85%] rounded-2xl px-4 py-2 text-sm',
                    'user' === m.role
                      ? 'bg-primary text-primary-foreground self-end'
                      : 'bg-muted text-foreground self-start',
                  )}
                >
                  <RichText text={m.content ?? ''} />
                </li>
              ),
            )}
            {pendingText ? (
              <>
                <li className="bg-primary text-primary-foreground max-w-[85%] self-end rounded-2xl px-4 py-2 text-sm">
                  {pendingText}
                </li>
                <li className="bg-muted text-muted-foreground self-start rounded-2xl px-4 py-2 text-sm">
                  {t('assistant.thinking')}
                </li>
              </>
            ) : null}
          </ol>
          <div ref={bottomRef} />
        </div>

        <form
          className="bg-background/95 fixed inset-x-0 bottom-20 z-30 mx-auto flex max-w-3xl gap-2 border-t p-3 backdrop-blur lg:bottom-0"
          onSubmit={(e) => {
            e.preventDefault();
            void send(text);
          }}
        >
          <Textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if ('Enter' === e.key && !e.shiftKey) {
                e.preventDefault();
                void send(text);
              }
            }}
            placeholder={t('assistant.placeholder')}
            aria-label={t('assistant.placeholder')}
            rows={1}
            className="max-h-32 min-h-11 resize-none"
            maxLength={2000}
          />
          <Button
            type="submit"
            size="icon"
            className="size-11 shrink-0"
            disabled={!text.trim() || sendMutation.isPending}
            aria-label={t('assistant.send')}
          >
            <SendIcon className="size-5" aria-hidden />
          </Button>
        </form>
      </MainLayout>
    </>
  );
};

AssistantPage.auth = true;

export const getStaticProps = withI18nStaticProps(['common']);

export default AssistantPage;
