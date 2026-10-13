import { CheckIcon, ChevronDownIcon } from 'lucide-react';
import { useTranslation } from 'next-i18next';
import React, { useCallback, useMemo, useState } from 'react';
import { toast } from 'sonner';

import { useTranslationWithUtils } from '~/hooks/useTranslationWithUtils';
import { categorySection } from '~/lib/analytics';
import { CATEGORIES } from '~/lib/category';
import { type DebtItem } from '~/lib/debts';
import { cn } from '~/lib/utils';
import { type RouterOutputs, api } from '~/utils/api';

import { Button } from '../ui/button';
import { CategoryIcon } from '../ui/categoryIcons';

export type PairDebtsData = RouterOutputs['debts']['getPair'];

export interface DebtGroups {
  fixed: DebtItem[];
  sections: { section: string; items: DebtItem[] }[];
}

/** One person's debts, without payments, oldest first: fixed ones apart, variables by section. */
export const debtGroups = (
  data: PairDebtsData,
  debtorId: number,
  filter: (item: DebtItem) => boolean = (i) => 0n < i.remaining,
): DebtGroups => {
  const time = (expenseId: string) =>
    new Date(data.expenses[expenseId]?.expenseDate ?? 0).getTime();
  const items = data.items
    .filter((i) => i.debtorId === debtorId && filter(i))
    .sort((a, b) => time(a.expenseId) - time(b.expenseId));
  const sections = new Map<string, DebtItem[]>();
  items.forEach((item) => {
    if ('variable' === item.bucket.kind) {
      sections.set(item.bucket.section, [...(sections.get(item.bucket.section) ?? []), item]);
    }
  });
  return {
    fixed: items.filter((i) => 'fixed' === i.bucket.kind),
    sections: [...sections.entries()].map(([section, list]) => ({ section, items: list })),
  };
};

export const useCategoryName = () => {
  const { t } = useTranslation('categories');
  return useCallback(
    (category: string) => {
      if (category in CATEGORIES) {
        return t(`categories_list.${category}.name`);
      }
      return t(`categories_list.${categorySection(category)}.items.${category}`);
    },
    [t],
  );
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

export const DebtRow: React.FC<{
  item: DebtItem;
  data: PairDebtsData;
  currency: string;
  action?: React.ReactNode;
}> = ({ item, data, currency, action }) => {
  const { t, toUIDate, getCurrencyHelpersCached } = useTranslationWithUtils();
  const { toUIString } = getCurrencyHelpersCached(currency);
  const meta = data.expenses[item.expenseId];
  const isCovered = 0n === item.remaining;

  return (
    <div className="flex items-center gap-3 py-2">
      <CategoryIcon
        category={item.category}
        size={18}
        className={cn('text-muted-foreground shrink-0', isCovered && 'opacity-60')}
      />
      <div className={cn('flex min-w-0 flex-1 flex-col gap-1', isCovered && 'opacity-60')}>
        <div className="flex items-baseline justify-between gap-2">
          <span className="truncate text-sm font-medium">{meta?.name}</span>
          <span className="shrink-0 text-sm font-semibold tabular-nums">
            {isCovered ? (
              <span className="text-positive flex items-center gap-1">
                <CheckIcon className="size-4" aria-hidden />
                {t(`debts.${item.status}`)}
              </span>
            ) : (
              toUIString(item.remaining)
            )}
          </span>
        </div>
        <div className="text-muted-foreground flex justify-between gap-2 text-xs">
          <span>
            {meta ? toUIDate(meta.expenseDate) : ''}
            {item.reopened ? ` · ${t('debts.reopened')}` : ''}
          </span>
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
      {action}
    </div>
  );
};

/** Overall balance, the same as the Balances screen. */
export const DebtSummary: React.FC<{
  data: PairDebtsData;
  currency: string;
  currentUserId: number;
  friendName: string;
}> = ({ data, currency, currentUserId, friendName }) => {
  const { t, getCurrencyHelpersCached } = useTranslationWithUtils();
  const amount = getCurrencyHelpersCached(currency).toUIString(data.net);
  if (null === data.netDebtorId) {
    return <p className="text-lg font-semibold">{t('debts.even')}</p>;
  }
  return data.netDebtorId === currentUserId ? (
    <p className="text-negative text-lg font-semibold">{t('debts.you_owe', { amount })}</p>
  ) : (
    <p className="text-positive text-lg font-semibold">
      {t('debts.owes_you', { name: friendName, amount })}
    </p>
  );
};

/** A variable section folded into one row that expands to its expenses. */
const SectionDebts: React.FC<{
  section: string;
  items: DebtItem[];
  data: PairDebtsData;
  currency: string;
}> = ({ section, items, data, currency }) => {
  const { t, getCurrencyHelpersCached } = useTranslationWithUtils();
  const categoryName = useCategoryName();
  const [open, setOpen] = useState(false);
  const remaining = items.reduce((sum, i) => sum + i.remaining, 0n);

  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="hover:bg-muted/50 flex min-h-12 w-full items-center gap-3 rounded-md py-2 text-left"
      >
        <CategoryIcon category={section} size={18} className="text-muted-foreground shrink-0" />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium">{categoryName(section)}</span>
          <span className="text-muted-foreground block text-xs">
            {t('debts.expenses_count', { count: items.length })}
          </span>
        </span>
        <span className="shrink-0 text-sm font-semibold tabular-nums">
          {getCurrencyHelpersCached(currency).toUIString(remaining)}
        </span>
        <ChevronDownIcon
          className={cn(
            'text-muted-foreground size-4 shrink-0 transition-transform',
            open && 'rotate-180',
          )}
          aria-hidden
        />
      </button>
      {open ? (
        <div className="divide-border border-border ml-7 divide-y border-l pl-3">
          {items.map((item) => (
            <DebtRow key={item.expenseId} item={item} data={data} currency={currency} />
          ))}
        </div>
      ) : null}
    </div>
  );
};

const ReopenButton: React.FC<{ item: DebtItem }> = ({ item }) => {
  const { t } = useTranslationWithUtils();
  const apiUtils = api.useUtils();
  const reopenMutation = api.debts.reopen.useMutation();
  const toggle = useCallback(() => {
    reopenMutation
      .mutateAsync({ expenseId: item.expenseId, reopened: !item.reopened })
      .then(() => apiUtils.invalidate())
      .catch(() => toast.error(t('errors.saving_expense')));
  }, [reopenMutation, item, apiUtils, t]);
  return (
    <Button
      variant="ghost"
      size="sm"
      className="h-10 shrink-0"
      disabled={reopenMutation.isPending}
      onClick={toggle}
    >
      {item.reopened ? t('debts.undo_reopen') : t('debts.reopen')}
    </Button>
  );
};

const PersonDebts: React.FC<{
  data: PairDebtsData;
  debtorId: number;
  title: string;
  currency: string;
  onSettle?: (expenseIds: string[]) => void;
}> = ({ data, debtorId, title, currency, onSettle }) => {
  const { t, getCurrencyHelpersCached } = useTranslationWithUtils();
  const { toUIString } = getCurrencyHelpersCached(currency);
  const groups = useMemo(() => debtGroups(data, debtorId), [data, debtorId]);
  const total = data.owed[debtorId]?.total ?? 0n;
  if (0n === total) {
    return null;
  }

  return (
    <section aria-label={title} className="flex flex-col gap-2">
      <h3 className="flex justify-between gap-2 font-semibold">
        <span>{title}</span>
        <span className="tabular-nums">{toUIString(total)}</span>
      </h3>
      {0 < groups.fixed.length ? (
        <div>
          <h4 className="text-muted-foreground text-xs font-medium tracking-wide uppercase">
            {t('debts.fixed')}
          </h4>
          <div className="divide-border divide-y">
            {groups.fixed.map((item) => (
              <DebtRow
                key={item.expenseId}
                item={item}
                data={data}
                currency={currency}
                action={
                  <>
                    {item.reopened ? <ReopenButton item={item} /> : null}
                    {onSettle ? (
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-10 shrink-0"
                        onClick={() => onSettle([item.expenseId])}
                      >
                        {t('actions.settle_up')}
                      </Button>
                    ) : null}
                  </>
                }
              />
            ))}
          </div>
        </div>
      ) : null}
      {0 < groups.sections.length ? (
        <div>
          <h4 className="text-muted-foreground text-xs font-medium tracking-wide uppercase">
            {t('debts.variable')}
          </h4>
          <div className="divide-border divide-y">
            {groups.sections.map(({ section, items }) => (
              <SectionDebts
                key={section}
                section={section}
                items={items}
                data={data}
                currency={currency}
              />
            ))}
          </div>
        </div>
      ) : null}
    </section>
  );
};

/**
 * What each member still owes: fixed costs one by one (each settled on purpose) and
 * variable ones by section. Covered fixed costs are folded under "already paid".
 */
export const DebtList: React.FC<{
  data: PairDebtsData;
  currency: string;
  currentUserId: number;
  friendId: number;
  friendName: string;
  onSettle?: (expenseIds: string[]) => void;
}> = ({ data, currency, currentUserId, friendId, friendName, onSettle }) => {
  const { t, getCurrencyHelpersCached } = useTranslationWithUtils();
  const [showPaid, setShowPaid] = useState(false);
  const paidFixed = useMemo(
    () =>
      data.items
        .filter((i) => 'fixed' === i.bucket.kind && 0n === i.remaining)
        .sort(
          (a, b) =>
            new Date(data.expenses[b.expenseId]?.expenseDate ?? 0).getTime() -
            new Date(data.expenses[a.expenseId]?.expenseDate ?? 0).getTime(),
        ),
    [data],
  );
  const advance = data.advance;

  return (
    <div className="flex flex-col gap-5">
      <PersonDebts
        data={data}
        debtorId={currentUserId}
        title={t('debts.you_owe_title', { name: friendName })}
        currency={currency}
        onSettle={onSettle}
      />
      <PersonDebts
        data={data}
        debtorId={friendId}
        title={t('debts.owes_you_title', { name: friendName })}
        currency={currency}
        onSettle={onSettle}
      />
      {advance ? (
        <p className="text-muted-foreground flex justify-between gap-2 text-sm" role="note">
          <span>
            {advance.userId === currentUserId
              ? t('debts.advance_yours')
              : t('debts.advance_theirs', { name: friendName })}
          </span>
          <span className="tabular-nums">
            {getCurrencyHelpersCached(currency).toUIString(advance.amount)}
          </span>
        </p>
      ) : null}
      {0 < paidFixed.length ? (
        <div>
          <button
            type="button"
            onClick={() => setShowPaid((s) => !s)}
            aria-expanded={showPaid}
            className="text-muted-foreground hover:text-foreground flex min-h-11 items-center gap-1 text-sm"
          >
            <ChevronDownIcon
              className={cn('size-4 transition-transform', showPaid && 'rotate-180')}
              aria-hidden
            />
            {t('debts.paid_fixed', { count: paidFixed.length })}
          </button>
          {showPaid ? (
            <div className="divide-border divide-y">
              {paidFixed.map((item) => (
                <DebtRow
                  key={item.expenseId}
                  item={item}
                  data={data}
                  currency={currency}
                  action={item.coveredByHistory ? <ReopenButton item={item} /> : null}
                />
              ))}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
};
