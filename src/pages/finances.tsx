import { type FinanceEntry } from '@prisma/client';
import { keepPreviousData } from '@tanstack/react-query';
import { ChevronLeftIcon, CopyIcon, PlusIcon } from 'lucide-react';
import { useSession } from 'next-auth/react';
import Head from 'next/head';
import Link from 'next/link';
import React, { useCallback, useMemo, useState } from 'react';
import { toast } from 'sonner';

import {
  type FinanceEntryDraft,
  FinanceEntryDrawer,
} from '~/components/Analytics/FinanceEntryDrawer';
import { MonthStepper } from '~/components/Analytics/MonthStepper';
import MainLayout from '~/components/Layout/MainLayout';
import { Button } from '~/components/ui/button';
import { useMonthParam } from '~/hooks/useMonthParam';
import { useTranslationWithUtils } from '~/hooks/useTranslationWithUtils';
import { type FinanceEntryKind, shiftMonth } from '~/lib/analytics';
import { sameDayNextMonth } from '~/lib/finance';
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
  const { t, toUIDate, getCurrencyHelpersCached } = useTranslationWithUtils();
  const { data: session } = useSession();
  const { month, setMonth, currentMonth, timeZone, isReady } = useMonthParam();
  const [draft, setDraft] = useState<FinanceEntryDraft | null>(null);
  const [editing, setEditing] = useState<FinanceEntry | null>(null);
  const apiUtils = api.useUtils();

  const monthQuery = api.finance.getMonth.useQuery(
    { month, timeZone },
    { placeholderData: keepPreviousData, enabled: isReady },
  );
  const createManyMutation = api.finance.createMany.useMutation();

  const defaultCurrency = session?.user.defaultCurrency ?? session?.user.currency ?? 'EUR';

  const refresh = useCallback(() => {
    apiUtils.finance.invalidate().catch(console.error);
    apiUtils.analytics.invalidate().catch(console.error);
  }, [apiUtils]);

  const openNew = useCallback(
    (type: FinanceEntryKind) => {
      setEditing(null);
      setDraft({ type, currency: defaultCurrency, date: defaultDateFor(month, currentMonth) });
    },
    [defaultCurrency, month, currentMonth],
  );

  const openEdit = useCallback((entry: FinanceEntry) => {
    setEditing(entry);
    setDraft({ id: entry.id, type: entry.type, currency: entry.currency, date: entry.date });
  }, []);

  const close = useCallback(() => {
    setDraft(null);
    setEditing(null);
  }, []);

  const copyPrevious = useCallback(async () => {
    try {
      const previous = await apiUtils.finance.getMonth.fetch({
        month: shiftMonth(month, -1),
        timeZone,
      });
      if (!previous.length) {
        toast.info(t('finance.copy_previous_empty'));
        return;
      }
      const { count } = await createManyMutation.mutateAsync(
        previous.map((e) => ({
          type: e.type,
          amount: e.amount,
          currency: e.currency,
          category: e.category,
          description: e.description,
          date: sameDayNextMonth(e.date),
        })),
      );
      toast.success(t('finance.copy_previous_done', { count }));
      refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('finance.error'));
    }
  }, [apiUtils, month, timeZone, createManyMutation, t, refresh]);

  const entries = useMemo(() => monthQuery.data ?? [], [monthQuery.data]);
  const groups = useMemo(
    () =>
      (['INCOME', 'INVESTMENT'] as const).map((type) => ({
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

          {0 === entries.length && !monthQuery.isPlaceholderData ? (
            <Button
              variant="outline"
              className="h-11 self-start"
              onClick={copyPrevious}
              disabled={createManyMutation.isPending}
            >
              <CopyIcon className="mr-2 size-4" aria-hidden />
              {t('finance.copy_previous')}
            </Button>
          ) : null}

          {groups.map((group) => {
            const isIncome = 'INCOME' === group.type;
            return (
              <section
                key={group.type}
                className="bg-card rounded-xl border p-4"
                aria-labelledby={`finance-${group.type}`}
              >
                <div className="mb-3 flex items-center justify-between gap-2">
                  <div>
                    <h2 id={`finance-${group.type}`} className="text-base font-semibold">
                      {isIncome ? t('finance.income') : t('finance.investments')}
                    </h2>
                    {sumByCurrency(group.entries).map(([currency, total]) => (
                      <p key={currency} className="text-muted-foreground text-sm tabular-nums">
                        {t('finance.total')}: {getCurrencyHelpersCached(currency).toUIString(total)}
                      </p>
                    ))}
                  </div>
                  <Button variant="secondary" className="h-11" onClick={() => openNew(group.type)}>
                    <PlusIcon className="mr-1 size-4" aria-hidden />
                    {isIncome ? t('finance.add_income') : t('finance.add_investment')}
                  </Button>
                </div>

                {group.entries.length ? (
                  <ul className="flex flex-col">
                    {group.entries.map((entry) => {
                      const categoryName = t(`finance.categories.${entry.type}.${entry.category}`);
                      const name = entry.description || categoryName;
                      const amount = getCurrencyHelpersCached(entry.currency).toUIString(
                        entry.amount,
                      );
                      return (
                        <li key={entry.id} className="border-t first:border-t-0">
                          <button
                            type="button"
                            onClick={() => openEdit(entry)}
                            className="hover:bg-muted/50 flex min-h-14 w-full items-center justify-between gap-3 rounded-md px-1 py-2 text-left transition-colors"
                            aria-label={`${t('finance.edit_label', { name })}: ${amount}`}
                          >
                            <span className="min-w-0">
                              <span className="block truncate font-medium">{name}</span>
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
        </div>
        <FinanceEntryDrawer draft={draft} entry={editing} onClose={close} onSaved={refresh} />
      </MainLayout>
    </>
  );
};

FinancesPage.auth = true;

export const getStaticProps = withI18nStaticProps(['common']);

export default FinancesPage;
