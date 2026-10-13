import { AddExpenseFab } from '~/components/AddExpense/AddExpenseFab';
import { keepPreviousData } from '@tanstack/react-query';
import { ArrowDownRightIcon, ArrowUpRightIcon, DownloadIcon, UsersIcon } from 'lucide-react';
import { useSession } from 'next-auth/react';
import Head from 'next/head';
import Link from 'next/link';
import { useRouter } from 'next/router';
import React, { useCallback, useMemo, useState } from 'react';

import { CategoryBreakdown } from '~/components/Analytics/CategoryBreakdown';
import { DebtList, DebtSummary } from '~/components/Debts/DebtList';
import { DebtSelector } from '~/components/Debts/DebtSelector';
import { CategoryDonut, sectionPalette } from '~/components/Household/CategoryDonut';
import { PayerSplit } from '~/components/Household/PayerSplit';
import MainLayout from '~/components/Layout/MainLayout';
import { Button } from '~/components/ui/button';
import { CategoryIcon } from '~/components/ui/categoryIcons';
import { AppDrawer } from '~/components/ui/drawer';
import { getTimeZone, useIntlLocale } from '~/hooks/useMonthParam';
import { useTranslationWithUtils } from '~/hooks/useTranslationWithUtils';
import { HOUSEHOLD_PERIODS, type HouseholdPeriod } from '~/lib/household';
import { cn } from '~/lib/utils';
import { type NextPageWithUser } from '~/types';
import { type RouterOutputs, api } from '~/utils/api';
import { withI18nStaticProps } from '~/utils/i18n/server';

type HouseholdData = NonNullable<RouterOutputs['household']['get']>;

const Card: React.FC<{
  title: string;
  subtitle?: string;
  children: React.ReactNode;
  action?: React.ReactNode;
}> = ({ title, subtitle, children, action }) => (
  <section className="bg-card rounded-xl border p-4">
    <div className="mb-3 flex items-start justify-between gap-2">
      <div>
        <h2 className="text-base font-semibold">{title}</h2>
        {subtitle ? (
          <p className="text-muted-foreground text-xs first-letter:uppercase">{subtitle}</p>
        ) : null}
      </div>
      {action}
    </div>
    {children}
  </section>
);

const PeriodSelector: React.FC<{
  value: HouseholdPeriod;
  onChange: (p: HouseholdPeriod) => void;
}> = ({ value, onChange }) => {
  const { t } = useTranslationWithUtils();
  return (
    <div
      role="radiogroup"
      aria-label={t('household.period')}
      className="bg-muted flex rounded-full p-1"
    >
      {HOUSEHOLD_PERIODS.map((period) => (
        <button
          key={period}
          type="button"
          role="radio"
          aria-checked={value === period}
          onClick={() => onChange(period)}
          className={cn(
            'min-h-10 flex-1 rounded-full px-3 text-sm transition-colors',
            value === period
              ? 'bg-background text-foreground font-medium shadow-sm'
              : 'text-muted-foreground',
          )}
        >
          {t(`household.periods.${period}`)}
        </button>
      ))}
    </div>
  );
};

const DebtsCard: React.FC<{
  pair: HouseholdData['pairs'][number];
  currency: string;
  groupId: number;
}> = ({ pair, currency, groupId }) => {
  const { t, displayName } = useTranslationWithUtils();
  const { data: session } = useSession();
  const [open, setOpen] = useState(false);
  const currentUserId = session?.user.id ?? -1;
  const friendName = displayName(pair.friend, currentUserId);
  const { expenses, friend: _friend, ...debts } = pair;
  const data = { ...debts, expenses };

  return (
    <Card
      title={t('household.pending_title', { name: friendName })}
      action={
        null !== pair.debtorId ? (
          <AppDrawer
            trigger={<Button className="h-11">{t('actions.settle_up')}</Button>}
            open={open}
            onOpenChange={setOpen}
            title={t('actions.settle_up')}
            className="h-[85vh]"
          >
            <DebtSelector
              friend={pair.friend}
              groupId={groupId}
              currency={currency}
              onDone={() => setOpen(false)}
            />
          </AppDrawer>
        ) : null
      }
    >
      <div className="flex flex-col gap-4">
        <DebtSummary
          data={data}
          currency={currency}
          currentUserId={currentUserId}
          friendName={friendName}
        />
        <DebtList data={data} currency={currency} />
      </div>
    </Card>
  );
};

const HouseholdPage: NextPageWithUser = () => {
  const { t, i18n, toUIDate, displayName, getCurrencyHelpersCached } = useTranslationWithUtils([
    'common',
    'categories',
  ]);
  const router = useRouter();
  const { data: session } = useSession();
  const locale = useIntlLocale(i18n.language);
  const timeZone = useMemo(getTimeZone, []);
  const queryPeriod = router.query.period;
  const period: HouseholdPeriod = HOUSEHOLD_PERIODS.includes(queryPeriod as HouseholdPeriod)
    ? (queryPeriod as HouseholdPeriod)
    : 'month';

  const setPeriod = useCallback(
    (next: HouseholdPeriod) => {
      const { period: _p, ...rest } = router.query;
      router
        .replace(
          { pathname: router.pathname, query: 'month' === next ? rest : { ...rest, period: next } },
          undefined,
          {
            shallow: true,
          },
        )
        .catch(console.error);
    },
    [router],
  );

  const householdQuery = api.household.get.useQuery(
    { period, timeZone },
    { placeholderData: keepPreviousData, enabled: router.isReady },
  );
  const data = householdQuery.data;
  const currency = data?.group.currency ?? 'EUR';
  const helpers = getCurrencyHelpersCached(currency);
  const formatAmount = useCallback((amount: bigint) => helpers.toUIString(amount), [helpers]);
  const percent = useMemo(
    () => new Intl.NumberFormat(locale, { style: 'percent', maximumFractionDigits: 0 }),
    [locale],
  );
  const formatPercent = useCallback((value: number) => percent.format(value), [percent]);

  const palette = useMemo(
    () => sectionPalette(data?.stats.categories.map((c) => c.section) ?? []),
    [data?.stats.categories],
  );
  const memberName = useCallback(
    (userId: number) => {
      const member = data?.group.members.find((m) => m.id === userId);
      return member ? displayName(member, session?.user.id) : '';
    },
    [data?.group.members, displayName, session?.user.id],
  );

  const change =
    data && null !== data.previousTotal && 0n < data.previousTotal
      ? Number(data.stats.total - data.previousTotal) / Number(data.previousTotal)
      : null;

  return (
    <>
      <Head>
        <title>{t('household.title')}</title>
      </Head>
      <MainLayout
        title={data?.group.name ?? t('household.title')}
        loading={householdQuery.isPending}
      >
        {null === data ? (
          <section className="bg-card mt-4 flex flex-col items-center gap-3 rounded-xl border p-6 text-center">
            <h2 className="text-lg font-semibold">{t('household.empty_title')}</h2>
            <p className="text-muted-foreground text-sm">{t('household.empty_body')}</p>
            <div className="flex flex-wrap justify-center gap-2">
              <Button asChild className="h-11">
                <Link href="/groups">
                  <UsersIcon className="mr-2 size-4" aria-hidden />
                  {t('household.choose_group')}
                </Link>
              </Button>
              <Button asChild variant="secondary" className="h-11">
                <Link href="/import-tricount">
                  <DownloadIcon className="mr-2 size-4" aria-hidden />
                  {t('household.import_tricount')}
                </Link>
              </Button>
            </div>
          </section>
        ) : data ? (
          <div
            className={cn(
              'flex flex-col gap-4 transition-opacity',
              householdQuery.isPlaceholderData && 'opacity-60',
            )}
            aria-busy={householdQuery.isFetching}
          >
            {data.pairs.map((pair) => (
              <DebtsCard
                key={pair.friend.id}
                pair={pair}
                currency={currency}
                groupId={data.group.id}
              />
            ))}

            <PeriodSelector value={period} onChange={setPeriod} />

            <Card
              title={t('household.spending_title')}
              subtitle={t(`household.periods.${period}`)}
              action={
                <div className="text-right">
                  <p className="text-xl font-semibold">{formatAmount(data.stats.total)}</p>
                  {null !== change ? (
                    <p className="text-muted-foreground flex items-center justify-end gap-1 text-xs">
                      {0 <= change ? (
                        <ArrowUpRightIcon className="size-3.5" aria-hidden />
                      ) : (
                        <ArrowDownRightIcon className="size-3.5" aria-hidden />
                      )}
                      {t(
                        0 <= change
                          ? 'household.more_than_previous'
                          : 'household.less_than_previous',
                        {
                          rate: formatPercent(Math.abs(change)),
                        },
                      )}
                    </p>
                  ) : null}
                </div>
              }
            >
              {data.stats.categories.length ? (
                <CategoryBreakdown
                  categories={data.stats.categories}
                  formatAmount={formatAmount}
                  formatPercent={formatPercent}
                />
              ) : (
                <p className="text-muted-foreground text-sm">{t('household.no_expenses')}</p>
              )}
            </Card>

            {data.stats.payers.length ? (
              <Card title={t('household.who_paid')} subtitle={t(`household.periods.${period}`)}>
                <div className="flex flex-col gap-6">
                  <PayerSplit
                    payers={data.stats.payers.map((p) => ({
                      name: memberName(p.userId),
                      amount: p.amount,
                    }))}
                    formatAmount={formatAmount}
                    formatPercent={formatPercent}
                  />
                  <div className="grid gap-6 sm:grid-cols-2">
                    {data.stats.payers.map((payer) => (
                      <CategoryDonut
                        key={payer.userId}
                        title={
                          payer.userId === session?.user.id
                            ? t('household.what_on_you')
                            : t('household.what_on', { name: memberName(payer.userId) })
                        }
                        sections={payer.sections}
                        palette={palette}
                        formatAmount={formatAmount}
                        formatPercent={formatPercent}
                      />
                    ))}
                  </div>
                </div>
              </Card>
            ) : null}

            {data.recent.length ? (
              <Card
                title={t('household.recent')}
                action={
                  <Button asChild variant="ghost" size="sm" className="h-9">
                    <Link href={`/groups/${data.group.id}`}>{t('household.see_group')}</Link>
                  </Button>
                }
              >
                <ul className="divide-border flex flex-col divide-y">
                  {data.recent.map((expense) => (
                    <li key={expense.id}>
                      <Link
                        href={`/groups/${data.group.id}/expenses/${expense.id}`}
                        className="hover:bg-muted/50 flex min-h-14 items-center gap-3 rounded-md px-1 py-2"
                      >
                        <CategoryIcon
                          category={expense.category}
                          size={18}
                          className="text-muted-foreground shrink-0"
                        />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-medium">{expense.name}</span>
                          <span className="text-muted-foreground block text-xs">
                            {toUIDate(expense.expenseDate)} ·{' '}
                            {displayName(expense.paidByUser, session?.user.id)}
                          </span>
                        </span>
                        <span className="shrink-0 text-sm font-semibold tabular-nums">
                          {formatAmount(expense.amount)}
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>
              </Card>
            ) : null}
          </div>
        ) : null}
        <AddExpenseFab groupId={data?.group.id} />
      </MainLayout>
    </>
  );
};

HouseholdPage.auth = true;

export const getStaticProps = withI18nStaticProps(['common', 'categories']);

export default HouseholdPage;
