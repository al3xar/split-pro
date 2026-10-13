import { type FinanceEntry, type FinanceRecurrence } from '@prisma/client';
import { keepPreviousData } from '@tanstack/react-query';
import { ChevronLeftIcon, PlusIcon, RepeatIcon } from 'lucide-react';
import { useSession } from 'next-auth/react';
import { useTranslation } from 'next-i18next';
import Head from 'next/head';
import Link from 'next/link';
import React, { useCallback, useMemo, useState } from 'react';

import {
  type FinanceEntryDraft,
  FinanceEntryDrawer,
} from '~/components/Analytics/FinanceEntryDrawer';
import { MonthStepper } from '~/components/Analytics/MonthStepper';
import MainLayout from '~/components/Layout/MainLayout';
import { Button } from '~/components/ui/button';
import { useMonthParam } from '~/hooks/useMonthParam';
import { useTranslationWithUtils } from '~/hooks/useTranslationWithUtils';
import { type FinanceEntryKind, categorySection } from '~/lib/analytics';
import { CATEGORIES } from '~/lib/category';
import { cn } from '~/lib/utils';
import { type NextPageWithUser } from '~/types';
import { api } from '~/utils/api';
import { withI18nStaticProps } from '~/utils/i18n/server';

const defaultDateFor = (month: string, currentMonth: string) => {
  if (month === currentMonth) {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), now.getDate(), 12);
  }
  const [year, monthNumber] = month.split('-').map(Number) as [number, number];
  return new Date(year, monthNumber - 1, 1, 12);
};

const sumByCurrency = (entries: FinanceEntry[]) => {
  const totals = new Map<string, bigint>();
  entries.forEach((e) => totals.set(e.currency, (totals.get(e.currency) ?? 0n) + e.amount));
  return [...totals.entries()];
};

const FinancesPage: NextPageWithUser = () => {
  const { t, toUIDate, getCurrencyHelpersCached } = useTranslationWithUtils([
    'common',
    'categories',
  ]);
  const { t: tCategories } = useTranslation('categories');
  const personalCategoryName = (category: string) =>
    category in CATEGORIES
      ? tCategories(`categories_list.${category}.name`)
      : tCategories(`categories_list.${categorySection(category)}.items.${category}`);
  const { data: session } = useSession();
  const { month, setMonth, currentMonth, timeZone, isReady } = useMonthParam();
  const [draft, setDraft] = useState<FinanceEntryDraft | null>(null);
  const [editing, setEditing] = useState<FinanceEntry | null>(null);
  const [editingRecurrence, setEditingRecurrence] = useState<FinanceRecurrence | null>(null);
  const apiUtils = api.useUtils();

  const monthQuery = api.finance.getMonth.useQuery(
    { month, timeZone },
    { placeholderData: keepPreviousData, enabled: isReady },
  );
  const recurrencesQuery = api.finance.getRecurrences.useQuery();

  const defaultCurrency = session?.user.defaultCurrency ?? session?.user.currency ?? 'EUR';

  const refresh = useCallback(() => {
    apiUtils.finance.invalidate().catch(console.error);
    apiUtils.analytics.invalidate().catch(console.error);
  }, [apiUtils]);

  const openNew = useCallback(
    (type: FinanceEntryKind) => {
      setEditing(null);
      setEditingRecurrence(null);
      setDraft({
        type,
        currency: defaultCurrency,
        date: defaultDateFor(month, currentMonth),
        month,
      });
    },
    [defaultCurrency, month, currentMonth],
  );

  const openEdit = useCallback(
    (entry: FinanceEntry) => {
      setEditingRecurrence(null);
      setEditing(entry);
      setDraft({ type: entry.type, currency: entry.currency, date: entry.date, month });
    },
    [month],
  );

  const openEditRecurrence = useCallback(
    (recurrence: FinanceRecurrence) => {
      setEditing(null);
      setEditingRecurrence(recurrence);
      setDraft({
        type: recurrence.type,
        currency: recurrence.currency,
        date: defaultDateFor(month, currentMonth),
        month,
      });
    },
    [month, currentMonth],
  );

  const close = useCallback(() => {
    setDraft(null);
    setEditing(null);
    setEditingRecurrence(null);
  }, []);

  const entries = useMemo(() => monthQuery.data ?? [], [monthQuery.data]);
  const groups = useMemo(
    () =>
      (['INCOME', 'INVESTMENT', 'EXPENSE'] as const).map((type) => ({
        type,
        entries: entries.filter((e) => e.type === type),
      })),
    [entries],
  );

  return (
    <>
      <Head>
        <title>{t('finance.title')}</title>
      </Head>
      <MainLayout
        title={
          <div className="flex items-center gap-1">
            <Button variant="ghost" size="icon" className="size-11" asChild>
              <Link
                href={`/analytics${month === currentMonth ? '' : `?month=${month}`}`}
                aria-label={t('analytics.title')}
              >
                <ChevronLeftIcon className="size-6" aria-hidden />
              </Link>
            </Button>
            <h1 className="text-xl font-semibold">{t('finance.title')}</h1>
          </div>
        }
        loading={monthQuery.isPending}
      >
        <div
          className={cn(
            'flex flex-col gap-4 transition-opacity',
            monthQuery.isPlaceholderData && 'opacity-60',
          )}
          aria-busy={monthQuery.isFetching}
        >
          <MonthStepper month={month} onChange={setMonth} />
          <p className="text-muted-foreground text-xs">{t('finance.private_note')}</p>

          {groups.map((group) => {
            const isIncome = 'INCOME' === group.type;
            const isPersonal = 'EXPENSE' === group.type;
            if (isPersonal && 0 === group.entries.length) {
              return null;
            }
            return (
              <section
                key={group.type}
                className="bg-card rounded-xl border p-4"
                aria-labelledby={`finance-${group.type}`}
              >
                <div className="mb-3 flex items-center justify-between gap-2">
                  <div>
                    <h2 id={`finance-${group.type}`} className="text-base font-semibold">
                      {isPersonal
                        ? t('finance.personal_expenses')
                        : isIncome
                          ? t('finance.income')
                          : t('finance.investments')}
                    </h2>
                    {sumByCurrency(group.entries).map(([currency, total]) => (
                      <p key={currency} className="text-muted-foreground text-sm tabular-nums">
                        {t('finance.total')}: {getCurrencyHelpersCached(currency).toUIString(total)}
                      </p>
                    ))}
                  </div>
                  {isPersonal ? (
                    <Button asChild variant="ghost" className="h-11">
                      <Link href="/inbox">{t('inbox.title')}</Link>
                    </Button>
                  ) : (
                    <Button
                      variant="secondary"
                      className="h-11"
                      onClick={() => openNew(group.type)}
                    >
                      <PlusIcon className="mr-1 size-4" aria-hidden />
                      {isIncome ? t('finance.add_income') : t('finance.add_investment')}
                    </Button>
                  )}
                </div>

                {group.entries.length ? (
                  <ul className="flex flex-col">
                    {group.entries.map((entry) => {
                      const categoryName = isPersonal
                        ? personalCategoryName(entry.category)
                        : t(`finance.categories.${entry.type}.${entry.category}`);
                      const name = entry.description || categoryName;
                      const amount = getCurrencyHelpersCached(entry.currency).toUIString(
                        entry.amount,
                      );
                      return (
                        <li key={entry.id} className="border-t first:border-t-0">
                          <button
                            type="button"
                            onClick={() => (isPersonal ? undefined : openEdit(entry))}
                            disabled={isPersonal}
                            className="hover:bg-muted/50 flex min-h-14 w-full items-center justify-between gap-3 rounded-md px-1 py-2 text-left transition-colors"
                            aria-label={`${t('finance.edit_label', { name })}: ${amount}`}
                          >
                            <span className="min-w-0">
                              <span className="flex items-center gap-1.5 font-medium">
                                <span className="truncate">{name}</span>
                                {entry.recurrenceId ? (
                                  <RepeatIcon
                                    className="text-muted-foreground size-3.5 shrink-0"
                                    aria-label={t('finance.recurring_badge')}
                                  />
                                ) : null}
                              </span>
                              <span className="text-muted-foreground block text-xs">
                                {entry.description ? `${categoryName} · ` : ''}
                                {toUIDate(entry.date)}
                              </span>
                            </span>
                            <span className="shrink-0 font-semibold tabular-nums">{amount}</span>
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                ) : (
                  <p className="text-muted-foreground text-sm">
                    {isIncome ? t('finance.empty_income') : t('finance.empty_investments')}
                  </p>
                )}
              </section>
            );
          })}

          <section className="bg-card rounded-xl border p-4" aria-labelledby="finance-recurring">
            <h2 id="finance-recurring" className="flex items-center gap-2 text-base font-semibold">
              <RepeatIcon className="text-muted-foreground size-4" aria-hidden />
              {t('finance.recurring_title')}
            </h2>
            <p className="text-muted-foreground mb-2 text-xs">{t('finance.recurring_subtitle')}</p>
            {recurrencesQuery.data?.length ? (
              <ul className="flex flex-col">
                {recurrencesQuery.data.map((recurrence) => {
                  const categoryName = t(
                    `finance.categories.${recurrence.type}.${recurrence.category}`,
                  );
                  const name = recurrence.description || categoryName;
                  const amount = getCurrencyHelpersCached(recurrence.currency).toUIString(
                    recurrence.amount,
                  );
                  const kind =
                    'INCOME' === recurrence.type ? t('finance.income') : t('finance.investments');
                  return (
                    <li key={recurrence.id} className="border-t first:border-t-0">
                      <button
                        type="button"
                        onClick={() => openEditRecurrence(recurrence)}
                        className="hover:bg-muted/50 flex min-h-14 w-full items-center justify-between gap-3 rounded-md px-1 py-2 text-left transition-colors"
                        aria-label={`${t('finance.edit_label', { name })}: ${amount}, ${t('finance.recurring_item', { day: recurrence.dayOfMonth })}`}
                      >
                        <span className="min-w-0">
                          <span className="block truncate font-medium">{name}</span>
                          <span className="text-muted-foreground block text-xs">
                            {kind} · {t('finance.recurring_item', { day: recurrence.dayOfMonth })}
                          </span>
                        </span>
                        <span className="shrink-0 font-semibold tabular-nums">{amount}</span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <p className="text-muted-foreground text-sm">{t('finance.recurring_empty')}</p>
            )}
          </section>
        </div>
        <FinanceEntryDrawer
          draft={draft}
          entry={editing}
          recurrence={editingRecurrence}
          onClose={close}
          onSaved={refresh}
        />
      </MainLayout>
    </>
  );
};

FinancesPage.auth = true;

export const getStaticProps = withI18nStaticProps(['common', 'categories']);

export default FinancesPage;
