import { keepPreviousData } from '@tanstack/react-query';
import {
  ArrowDownRightIcon,
  ArrowUpRightIcon,
  ChevronRightIcon,
  LandmarkIcon,
  PiggyBankIcon,
  ShoppingBagIcon,
  TrendingUpIcon,
  WalletIcon,
} from 'lucide-react';
import Head from 'next/head';
import Link from 'next/link';
import React, { useCallback, useMemo, useState } from 'react';

import { CategoryBreakdown } from '~/components/Analytics/CategoryBreakdown';
import { ChartLegend, MonthlyBarChart } from '~/components/Analytics/MonthlyBarChart';
import { MonthStepper, formatMonth } from '~/components/Analytics/MonthStepper';
import { StatTile } from '~/components/Analytics/StatTile';
import MainLayout from '~/components/Layout/MainLayout';
import { Button } from '~/components/ui/button';
import { NativeSelect, NativeSelectOption } from '~/components/ui/native-select';
import { useIntlLocale, useMonthParam } from '~/hooks/useMonthParam';
import { useTranslationWithUtils } from '~/hooks/useTranslationWithUtils';
import { cn } from '~/lib/utils';
import { type NextPageWithUser } from '~/types';
import { api } from '~/utils/api';
import { withI18nStaticProps } from '~/utils/i18n/server';

const TREND_MONTHS = 12;

const Card: React.FC<{
  title: string;
  subtitle?: string;
  action?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}> = ({ title, subtitle, action, children, className }) => (
  <section className={cn('bg-card rounded-xl border p-4', className)}>
    <div className="mb-4 flex items-start justify-between gap-2">
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

const AnalyticsPage: NextPageWithUser = () => {
  const { t, i18n, getCurrencyHelpersCached } = useTranslationWithUtils(['common', 'categories']);
  const locale = useIntlLocale(i18n.language);
  const { month, setMonth, currentMonth, timeZone, isReady } = useMonthParam();
  const [currency, setCurrency] = useState<string | undefined>(undefined);
  const [showTable, setShowTable] = useState(false);

  const overviewQuery = api.analytics.getOverview.useQuery(
    { month, months: TREND_MONTHS, currency, timeZone },
    { placeholderData: keepPreviousData, enabled: isReady },
  );
  const data = overviewQuery.data;
  const activeCurrency = data?.currency ?? currency ?? 'EUR';
  const helpers = getCurrencyHelpersCached(activeCurrency);
  const decimals = helpers.formatter.resolvedOptions().maximumFractionDigits ?? 2;

  const formatAmount = useCallback((amount: bigint) => helpers.toUIString(amount), [helpers]);
  const formatUnits = useCallback(
    (units: number) => helpers.toUIString(BigInt(Math.round(units))),
    [helpers],
  );
  const compact = useMemo(
    () =>
      new Intl.NumberFormat(locale, {
        style: 'currency',
        currency: activeCurrency,
        notation: 'compact',
        maximumFractionDigits: 1,
      }),
    [locale, activeCurrency],
  );
  const formatAxis = useCallback(
    (units: number) => compact.format(units / 10 ** decimals),
    [compact, decimals],
  );
  const percent = useMemo(
    () => new Intl.NumberFormat(locale, { style: 'percent', maximumFractionDigits: 0 }),
    [locale],
  );
  const formatPercent = useCallback((value: number) => percent.format(value), [percent]);

  const current = data?.months.at(-1);
  const shortLabels = useMemo(
    () =>
      data?.months.map((m) => formatMonth(m.month, locale, { month: 'short' }).replace('.', '')) ??
      [],
    [data, locale],
  );
  const longLabels = useMemo(
    () => data?.months.map((m) => formatMonth(m.month, locale)) ?? [],
    [data, locale],
  );

  const onCurrencyChange = useCallback(
    (e: React.ChangeEvent<HTMLSelectElement>) => setCurrency(e.target.value),
    [],
  );
  const toggleTable = useCallback(() => setShowTable((s) => !s), []);

  const isEmpty =
    data && data.months.every((m) => 0n === m.expenses && 0n === m.income && 0n === m.investments);

  const change = data?.summary.expensesChange;
  const savingsRate = data?.summary.savingsRate;

  return (
    <>
      <Head>
        <title>{t('analytics.title')}</title>
      </Head>
      <MainLayout title={t('analytics.title')} loading={overviewQuery.isPending}>
        <div
          className={cn(
            'flex flex-col gap-4 transition-opacity',
            overviewQuery.isPlaceholderData && 'opacity-60',
          )}
          aria-busy={overviewQuery.isFetching}
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <MonthStepper month={month} onChange={setMonth} maxMonth={currentMonth} />
            {data && 1 < data.currencies.length ? (
              <label className="flex items-center gap-2 text-sm">
                <span className="text-muted-foreground">{t('analytics.currency')}</span>
                <NativeSelect value={activeCurrency} onChange={onCurrencyChange} className="h-11">
                  {data.currencies.map((c) => (
                    <NativeSelectOption key={c} value={c}>
                      {c}
                    </NativeSelectOption>
                  ))}
                </NativeSelect>
              </label>
            ) : null}
          </div>

          {isEmpty ? (
            <div className="bg-card rounded-xl border p-6 text-center">
              <p className="font-semibold">{t('analytics.empty_title')}</p>
              <p className="text-muted-foreground mt-1 text-sm">{t('analytics.empty_body')}</p>
            </div>
          ) : null}

          {current ? (
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              <StatTile
                label={t('analytics.expenses')}
                value={formatAmount(current.expenses)}
                icon={<ShoppingBagIcon className="size-4" aria-hidden />}
              >
                {null === change || undefined === change ? (
                  t('analytics.no_previous')
                ) : (
                  <span className="flex items-center gap-1">
                    {0 <= change ? (
                      <ArrowUpRightIcon className="size-3.5 shrink-0" aria-hidden />
                    ) : (
                      <ArrowDownRightIcon className="size-3.5 shrink-0" aria-hidden />
                    )}
                    {t(0 <= change ? 'analytics.vs_previous_up' : 'analytics.vs_previous_down', {
                      rate: formatPercent(Math.abs(change)),
                    })}
                  </span>
                )}
                <span className="mt-0.5 block">
                  {t('analytics.household', { amount: formatAmount(current.householdExpenses) })}
                </span>
              </StatTile>
              <StatTile
                label={t('analytics.income')}
                value={formatAmount(current.income)}
                icon={<WalletIcon className="size-4" aria-hidden />}
              >
                {0n === current.income ? t('analytics.no_income') : null}
              </StatTile>
              <StatTile
                label={t('analytics.savings')}
                value={formatAmount(current.savings)}
                icon={<PiggyBankIcon className="size-4" aria-hidden />}
              >
                {0n > current.savings && 0n < current.income
                  ? t('analytics.savings_negative')
                  : null !== savingsRate && undefined !== savingsRate
                    ? t('analytics.savings_rate', { rate: formatPercent(savingsRate) })
                    : null}
              </StatTile>
              <StatTile
                label={t('analytics.investments')}
                value={formatAmount(current.investments)}
                icon={<TrendingUpIcon className="size-4" aria-hidden />}
              >
                {0n < current.savings && 0n < current.investments
                  ? t('analytics.invested_share', {
                      rate: formatPercent(Number(current.investments) / Number(current.savings)),
                    })
                  : null}
              </StatTile>
            </div>
          ) : null}

          <Link
            href="/finances"
            className="bg-card hover:bg-muted/40 flex min-h-11 items-center gap-3 rounded-xl border p-4 transition-colors"
          >
            <span className="bg-muted flex size-10 shrink-0 items-center justify-center rounded-full">
              <LandmarkIcon className="text-primary size-5" aria-hidden />
            </span>
            <span className="flex-1">
              <span className="block font-medium">{t('analytics.manage_finances')}</span>
              <span className="text-muted-foreground block text-xs">
                {t('analytics.manage_finances_hint')}
              </span>
            </span>
            <ChevronRightIcon className="text-muted-foreground size-5" aria-hidden />
          </Link>

          <Card title={t('analytics.categories_title')} subtitle={longLabels.at(-1)}>
            {data?.categories.length ? (
              <CategoryBreakdown
                categories={data.categories}
                formatAmount={formatAmount}
                formatPercent={formatPercent}
              />
            ) : (
              <p className="text-muted-foreground text-sm">{t('analytics.categories_empty')}</p>
            )}
          </Card>

          {data ? (
            <Card
              title={t('analytics.trend_title')}
              subtitle={t('analytics.trend_subtitle', { count: TREND_MONTHS })}
              action={
                <Button variant="ghost" size="sm" className="h-9" onClick={toggleTable}>
                  {showTable ? t('analytics.show_chart') : t('analytics.show_table')}
                </Button>
              }
            >
              {showTable ? (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <caption className="sr-only">{t('analytics.trend_title')}</caption>
                    <thead>
                      <tr className="text-muted-foreground text-left text-xs">
                        <th scope="col" className="py-2 font-medium">
                          {t('analytics.table.month')}
                        </th>
                        {(['income', 'expenses', 'savings', 'investments'] as const).map((key) => (
                          <th key={key} scope="col" className="py-2 text-right font-medium">
                            {t(`analytics.table.${key}`)}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {[...data.months].reverse().map((m) => (
                        <tr key={m.month} className="border-t">
                          <th
                            scope="row"
                            className="py-2 text-left font-normal first-letter:uppercase"
                          >
                            {formatMonth(m.month, locale)}
                          </th>
                          <td className="py-2 text-right tabular-nums">{formatAmount(m.income)}</td>
                          <td className="py-2 text-right tabular-nums">
                            {formatAmount(m.expenses)}
                          </td>
                          <td className="py-2 text-right tabular-nums">
                            {formatAmount(m.savings)}
                          </td>
                          <td className="py-2 text-right tabular-nums">
                            {formatAmount(m.investments)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div className="flex flex-col gap-3">
                  <ChartLegend
                    items={[
                      { label: t('analytics.income'), color: 'var(--chart-income)' },
                      { label: t('analytics.expenses'), color: 'var(--chart-expense)' },
                    ]}
                  />
                  <div className="pt-16">
                    <MonthlyBarChart
                      labels={shortLabels}
                      longLabels={longLabels}
                      highlightIndex={data.months.length - 1}
                      formatValue={formatUnits}
                      formatAxis={formatAxis}
                      series={[
                        {
                          key: 'income',
                          label: t('analytics.income'),
                          color: 'var(--chart-income)',
                          values: data.months.map((m) => Number(m.income)),
                        },
                        {
                          key: 'expenses',
                          label: t('analytics.expenses'),
                          color: 'var(--chart-expense)',
                          values: data.months.map((m) => Number(m.expenses)),
                        },
                      ]}
                    />
                  </div>
                </div>
              )}
            </Card>
          ) : null}

          {data && !showTable ? (
            <Card title={t('analytics.savings_title')} subtitle={t('analytics.savings_subtitle')}>
              <div className="pt-16">
                <MonthlyBarChart
                  labels={shortLabels}
                  longLabels={longLabels}
                  highlightIndex={data.months.length - 1}
                  formatValue={formatUnits}
                  formatAxis={formatAxis}
                  height={140}
                  series={[
                    {
                      key: 'savings',
                      label: t('analytics.savings'),
                      color: 'var(--chart-positive)',
                      negativeColor: 'var(--chart-negative)',
                      values: data.months.map((m) => Number(m.savings)),
                    },
                  ]}
                />
              </div>
            </Card>
          ) : null}
        </div>
      </MainLayout>
    </>
  );
};

AnalyticsPage.auth = true;

export const getStaticProps = withI18nStaticProps(['common', 'categories']);

export default AnalyticsPage;
