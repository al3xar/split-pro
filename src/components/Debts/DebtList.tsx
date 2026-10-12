import { CheckIcon, ChevronDownIcon } from 'lucide-react';
import React, { useCallback, useMemo, useState } from 'react';

import { useTranslationWithUtils } from '~/hooks/useTranslationWithUtils';
import { type DebtItem, type DebtPriority } from '~/lib/debts';
import { cn } from '~/lib/utils';
import { type RouterOutputs } from '~/utils/api';

import { CategoryIcon } from '../ui/categoryIcons';

export type PairDebtsData = RouterOutputs['debts']['getPair'];

const PRIORITIES: DebtPriority[] = [1, 2, 3, 4];

/** The debtor's debts in the pair, without payments, grouped by priority. */
export const debtorItemsByPriority = (data: PairDebtsData) => {
  const time = (expenseId: string) =>
    new Date(data.expenses[expenseId]?.expenseDate ?? 0).getTime();
  const items = data.items
    .filter(
      (i) => i.debtorId === data.debtorId && 'SETTLEMENT' !== data.expenses[i.expenseId]?.splitType,
    )
    .sort((a, b) => time(a.expenseId) - time(b.expenseId));
  return PRIORITIES.map((priority) => ({
    priority,
    items: items.filter((i) => i.priority === priority),
  })).filter((group) => 0 < group.items.length);
};

const ProgressBar: React.FC<{ covered: bigint; amount: bigint }> = ({ covered, amount }) => {
  const percent = 0n === amount ? 100 : Number((covered * 100n) / amount);
  return (
    <div className="bg-muted h-1.5 w-full overflow-hidden rounded-full" aria-hidden>
      <div
        className="bg-positive h-full rounded-full"
        style={{ width: `${Math.max(0, Math.min(100, percent))}%` }}
      />
    </div>
  );
};

export const DebtRow: React.FC<{ item: DebtItem; data: PairDebtsData; currency: string }> = ({
  item,
  data,
  currency,
}) => {
  const { t, toUIDate, getCurrencyHelpersCached } = useTranslationWithUtils();
  const { toUIString } = getCurrencyHelpersCached(currency);
  const meta = data.expenses[item.expenseId];
  const isSettled = 'settled' === item.status;

  return (
    <div className={cn('flex items-center gap-3 py-2', isSettled && 'opacity-60')}>
      <CategoryIcon category={item.category} size={18} className="text-muted-foreground shrink-0" />
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <div className="flex items-baseline justify-between gap-2">
          <span className="truncate text-sm font-medium">{meta?.name}</span>
          <span className="shrink-0 text-sm font-semibold tabular-nums">
            {isSettled ? (
              <span className="text-positive flex items-center gap-1">
                <CheckIcon className="size-4" aria-hidden />
                {t('debts.settled')}
              </span>
            ) : (
              toUIString(item.remaining)
            )}
          </span>
        </div>
        <div className="text-muted-foreground flex justify-between gap-2 text-xs">
          <span>{meta ? toUIDate(meta.expenseDate) : ''}</span>
          {'partial' === item.status ? (
            <span>
              {t('debts.remaining_of', {
                remaining: toUIString(item.remaining),
                amount: toUIString(item.amount),
              })}
            </span>
          ) : null}
        </div>
        {'partial' === item.status ? (
          <ProgressBar covered={item.covered} amount={item.amount} />
        ) : null}
      </div>
    </div>
  );
};

export const DebtSummary: React.FC<{
  data: PairDebtsData;
  currency: string;
  currentUserId: number;
  friendName: string;
}> = ({ data, currency, currentUserId, friendName }) => {
  const { t, getCurrencyHelpersCached } = useTranslationWithUtils();
  const amount = getCurrencyHelpersCached(currency).toUIString(data.net);
  if (null === data.debtorId) {
    return <p className="text-lg font-semibold">{t('debts.even')}</p>;
  }
  return data.debtorId === currentUserId ? (
    <p className="text-negative text-lg font-semibold">{t('debts.you_owe', { amount })}</p>
  ) : (
    <p className="text-positive text-lg font-semibold">
      {t('debts.owes_you', { name: friendName, amount })}
    </p>
  );
};

/** Pending debts grouped by priority, with settled ones folded away. */
export const DebtList: React.FC<{ data: PairDebtsData; currency: string }> = ({
  data,
  currency,
}) => {
  const { t, getCurrencyHelpersCached } = useTranslationWithUtils();
  const [showSettled, setShowSettled] = useState(false);
  const toggle = useCallback(() => setShowSettled((s) => !s), []);
  const groups = useMemo(() => debtorItemsByPriority(data), [data]);
  const settledCount = groups.reduce(
    (count, g) => count + g.items.filter((i) => 'settled' === i.status).length,
    0,
  );

  if (0 === groups.length) {
    return null;
  }

  return (
    <div className="flex flex-col gap-4">
      {groups.map((group) => {
        const visible = group.items.filter((i) => showSettled || 'settled' !== i.status);
        if (0 === visible.length) {
          return null;
        }
        return (
          <section key={group.priority} aria-label={t(`debts.priority.${group.priority}`)}>
            <h3 className="text-muted-foreground mb-1 flex justify-between text-xs font-medium tracking-wide uppercase">
              <span>{t(`debts.priority.${group.priority}`)}</span>
              <span className="tabular-nums">
                {getCurrencyHelpersCached(currency).toUIString(
                  data.remainingByPriority[group.priority],
                )}
              </span>
            </h3>
            <div className="divide-border divide-y">
              {visible.map((item) => (
                <DebtRow key={item.expenseId} item={item} data={data} currency={currency} />
              ))}
            </div>
          </section>
        );
      })}
      {0 < settledCount ? (
        <button
          type="button"
          onClick={toggle}
          aria-expanded={showSettled}
          className="text-muted-foreground hover:text-foreground flex min-h-11 items-center gap-1 self-start text-sm"
        >
          <ChevronDownIcon
            className={cn('size-4 transition-transform', showSettled && 'rotate-180')}
            aria-hidden
          />
          {t('debts.settled_count', { count: settledCount })}
        </button>
      ) : null}
    </div>
  );
};
