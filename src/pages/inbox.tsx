import { ChevronLeftIcon, FileUpIcon, SparklesIcon, Undo2Icon } from 'lucide-react';
import { useTranslation } from 'next-i18next';
import Head from 'next/head';
import Link from 'next/link';
import React, { useCallback, useMemo, useState } from 'react';
import { toast } from 'sonner';

import MainLayout from '~/components/Layout/MainLayout';
import { Button } from '~/components/ui/button';
import { CategoryIcon } from '~/components/ui/categoryIcons';
import { Checkbox } from '~/components/ui/checkbox';
import { NativeSelect, NativeSelectOption } from '~/components/ui/native-select';
import { useTranslationWithUtils } from '~/hooks/useTranslationWithUtils';
import { categorySection } from '~/lib/analytics';
import { CATEGORIES } from '~/lib/category';
import { cn } from '~/lib/utils';
import { useAddExpenseDialog } from '~/store/addExpenseDialogStore';
import { type NextPageWithUser } from '~/types';
import { type RouterOutputs, api } from '~/utils/api';
import { withI18nStaticProps } from '~/utils/i18n/server';

type Movement = RouterOutputs['inbox']['list'][number];
const STATUSES = ['PENDING', 'SHARED', 'PERSONAL', 'INCOME', 'IGNORED'] as const;
type Status = (typeof STATUSES)[number];

/** Every category as [value, label], grouped like the category picker. */
const useCategoryOptions = () => {
  const { t } = useTranslation('categories');
  return useMemo(
    () =>
      Object.entries(CATEGORIES).flatMap(([section, items]) =>
        items.map((item) => {
          const value = 'other' === item ? section : item;
          return [
            value,
            `${t(`categories_list.${section}.name`)} · ${t(`categories_list.${section}.items.${item}`)}`,
          ] as const;
        }),
      ),
    [t],
  );
};

/** "mercadona valencia" → "Mercadona Valencia" for the expense name. */
const merchantName = (pattern: string) =>
  pattern.replace(/\b\p{L}/gu, (letter) => letter.toUpperCase()).slice(0, 100);

const categoryLabel = (t: (key: string) => string, category: string | null) => {
  if (!category) {
    return null;
  }
  if (category in CATEGORIES) {
    return t(`categories_list.${category}.name`);
  }
  return t(`categories_list.${categorySection(category)}.items.${category}`);
};

const InboxPage: NextPageWithUser = () => {
  const { t, toUIDate, getCurrencyHelpersCached } = useTranslationWithUtils([
    'common',
    'categories',
  ]);
  const { t: tCategories } = useTranslation('categories');
  const categoryOptions = useCategoryOptions();
  const openWith = useAddExpenseDialog((s) => s.openWith);
  const [status, setStatus] = useState<Status>('PENDING');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [remember, setRemember] = useState(true);
  const [categories, setCategories] = useState<Record<string, string>>({});

  const contextQuery = api.inbox.context.useQuery();
  const listQuery = api.inbox.list.useQuery({ status });
  const classifyMutation = api.inbox.classify.useMutation();
  const linkMutation = api.inbox.linkExpense.useMutation();
  const undoMutation = api.inbox.undo.useMutation();
  const apiUtils = api.useUtils();

  const refresh = useCallback(() => {
    setSelected(new Set());
    apiUtils.inbox.invalidate().catch(console.error);
    apiUtils.analytics.invalidate().catch(console.error);
    apiUtils.finance.invalidate().catch(console.error);
  }, [apiUtils]);

  const categoryOf = (m: Movement) => categories[m.id] ?? m.suggestion.category ?? 'general';

  const classify = useCallback(
    async (ids: string[], action: 'PERSONAL' | 'INCOME' | 'IGNORED', category?: string) => {
      try {
        await classifyMutation.mutateAsync({ ids, action, category, remember });
        refresh();
      } catch (error) {
        toast.error(error instanceof Error ? error.message : t('inbox.error'));
      }
    },
    [classifyMutation, remember, refresh, t],
  );

  const share = (m: Movement) => {
    const group = contextQuery.data?.householdGroup;
    openWith({
      groupId: group?.id,
      name: merchantName(m.pattern) || m.description.slice(0, 100),
      amount: 0n > m.amount ? -m.amount : m.amount,
      currency: m.currency,
      category: categoryOf(m),
      expenseDate: m.date,
      onSaved: (expenseId) => {
        linkMutation
          .mutateAsync({ id: m.id, expenseId, remember })
          .then(refresh)
          .catch((error: unknown) =>
            toast.error(error instanceof Error ? error.message : t('inbox.error')),
          );
      },
    });
  };

  const items = listQuery.data ?? [];
  const toggle = (id: string) =>
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });

  return (
    <>
      <Head>
        <title>{t('inbox.title')}</title>
      </Head>
      <MainLayout
        title={
          <div className="flex items-center gap-1">
            <Button variant="ghost" size="icon" className="size-11" asChild>
              <Link href="/household" aria-label={t('navigation.household')}>
                <ChevronLeftIcon className="size-6" aria-hidden />
              </Link>
            </Button>
            <h1 className="text-xl font-semibold">{t('inbox.title')}</h1>
          </div>
        }
        actions={
          <Button asChild variant="secondary" className="h-11">
            <Link href="/bank-import">
              <FileUpIcon className="mr-2 size-4" aria-hidden />
              {t('inbox.import')}
            </Link>
          </Button>
        }
      >
        <div className="flex flex-col gap-4">
          <div
            role="tablist"
            aria-label={t('inbox.title')}
            className="flex gap-2 overflow-x-auto pb-1"
          >
            {STATUSES.map((s) => (
              <button
                key={s}
                type="button"
                role="tab"
                aria-selected={status === s}
                onClick={() => {
                  setStatus(s);
                  setSelected(new Set());
                }}
                className={cn(
                  'min-h-11 shrink-0 rounded-full border px-4 text-sm',
                  status === s
                    ? 'border-primary bg-primary/15 font-medium'
                    : 'text-muted-foreground',
                )}
              >
                {t(`inbox.status.${s}`)}
              </button>
            ))}
          </div>

          {'PENDING' === status ? (
            <label className="flex min-h-11 items-center gap-3 text-sm">
              <Checkbox checked={remember} onCheckedChange={(v) => setRemember(true === v)} />
              {t('inbox.remember')}
            </label>
          ) : null}

          {'PENDING' === status && 0 < selected.size ? (
            <div
              className="bg-muted sticky top-0 z-10 flex flex-wrap items-center gap-2 rounded-xl p-3"
              role="toolbar"
            >
              <span className="text-sm font-medium">
                {t('inbox.selected', { count: selected.size })}
              </span>
              <Button
                size="sm"
                className="h-10"
                onClick={() => void classify([...selected], 'PERSONAL')}
              >
                {t('inbox.personal')}
              </Button>
              <Button
                size="sm"
                variant="secondary"
                className="h-10"
                onClick={() => void classify([...selected], 'IGNORED')}
              >
                {t('inbox.ignore')}
              </Button>
            </div>
          ) : null}

          {listQuery.isPending ? null : 0 === items.length ? (
            <div className="bg-card rounded-xl border p-6 text-center">
              <p className="font-semibold">{t(`inbox.empty.${status}`)}</p>
              {'PENDING' === status ? (
                <Button asChild className="mt-3 h-11">
                  <Link href="/bank-import">{t('inbox.import')}</Link>
                </Button>
              ) : null}
            </div>
          ) : (
            <ul className="flex flex-col gap-2">
              {items.map((m) => {
                const isOut = 0n > m.amount;
                const amount = getCurrencyHelpersCached(m.currency).toUIString(m.amount, true);
                const suggestedLabel = categoryLabel(
                  tCategories,
                  m.suggestion.category ?? m.category,
                );
                return (
                  <li key={m.id} className="bg-card flex flex-col gap-3 rounded-xl border p-3">
                    <div className="flex items-start gap-3">
                      {'PENDING' === status ? (
                        <Checkbox
                          className="mt-1 size-5"
                          checked={selected.has(m.id)}
                          onCheckedChange={() => toggle(m.id)}
                          aria-label={t('inbox.select', { name: m.description })}
                        />
                      ) : null}
                      <CategoryIcon
                        category={m.category ?? m.suggestion.category ?? 'general'}
                        size={18}
                        className="text-muted-foreground mt-0.5 shrink-0"
                      />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium">{m.description}</p>
                        <p className="text-muted-foreground text-xs">
                          {toUIDate(m.date)} · {m.source}
                          {suggestedLabel ? ` · ${suggestedLabel}` : ''}
                        </p>
                        {'PENDING' === status && m.suggestion.fromRule && m.suggestion.action ? (
                          <p className="text-primary mt-1 flex items-center gap-1 text-xs">
                            <SparklesIcon className="size-3" aria-hidden />
                            {t('inbox.suggested', {
                              action: t(`inbox.status.${m.suggestion.action}`),
                            })}
                          </p>
                        ) : null}
                      </div>
                      <span
                        className={cn(
                          'shrink-0 text-sm font-semibold tabular-nums',
                          isOut ? 'text-negative' : 'text-positive',
                        )}
                      >
                        {amount}
                      </span>
                    </div>

                    {'PENDING' === status ? (
                      <div className="flex flex-wrap items-center gap-2">
                        {isOut ? (
                          <>
                            <Button
                              size="sm"
                              className="h-10"
                              onClick={() => share(m)}
                              disabled={!contextQuery.data?.householdGroup}
                            >
                              {t('inbox.shared')}
                            </Button>
                            <NativeSelect
                              size="sm"
                              className="h-10 max-w-48"
                              aria-label={t('inbox.category_for', { name: m.description })}
                              value={categoryOf(m)}
                              onChange={(e) =>
                                setCategories((c) => ({ ...c, [m.id]: e.target.value }))
                              }
                            >
                              {categoryOptions.map(([value, label]) => (
                                <NativeSelectOption key={value} value={value}>
                                  {label}
                                </NativeSelectOption>
                              ))}
                            </NativeSelect>
                            <Button
                              size="sm"
                              variant="secondary"
                              className="h-10"
                              onClick={() => void classify([m.id], 'PERSONAL', categoryOf(m))}
                            >
                              {t('inbox.personal')}
                            </Button>
                          </>
                        ) : (
                          <Button
                            size="sm"
                            className="h-10"
                            onClick={() => void classify([m.id], 'INCOME')}
                          >
                            {t('inbox.income')}
                          </Button>
                        )}
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-10"
                          onClick={() => void classify([m.id], 'IGNORED')}
                        >
                          {t('inbox.ignore')}
                        </Button>
                      </div>
                    ) : (
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-10 self-start"
                        onClick={() => {
                          undoMutation.mutateAsync({ id: m.id }).then(refresh).catch(console.error);
                        }}
                      >
                        <Undo2Icon className="mr-2 size-4" aria-hidden />
                        {t('inbox.undo')}
                      </Button>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
          {'PENDING' === status && !contextQuery.data?.householdGroup && !contextQuery.isPending ? (
            <p className="text-muted-foreground text-xs" role="note">
              {t('inbox.no_household')}
            </p>
          ) : null}
        </div>
      </MainLayout>
    </>
  );
};

InboxPage.auth = true;

export const getStaticProps = withI18nStaticProps(['common', 'categories']);

export default InboxPage;
