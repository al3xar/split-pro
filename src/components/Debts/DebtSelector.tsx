import { type User } from '@prisma/client';
import { TRPCClientError } from '@trpc/client';
import { useSession } from 'next-auth/react';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';

import { useTranslationWithUtils } from '~/hooks/useTranslationWithUtils';
import { type DebtPriority } from '~/lib/debts';
import { cn } from '~/lib/utils';
import { api } from '~/utils/api';

import { Button } from '../ui/button';
import { Checkbox } from '../ui/checkbox';
import { LoadingSpinner } from '../ui/spinner';
import { DebtRow, DebtSummary, debtorItemsByPriority } from './DebtList';

/**
 * Lets either member register a payment from the net debtor that covers the chosen
 * debts. Renders `fallback` when the balance has no per-expense debts behind it
 * (e.g. groups with simplified debts).
 */
export const DebtSelector: React.FC<{
  friend: User;
  groupId: number | null;
  currency: string;
  onDone: () => void;
  fallback?: React.ReactNode;
}> = ({ friend, groupId, currency, onDone, fallback }) => {
  const { t, displayName, getCurrencyHelpersCached } = useTranslationWithUtils();
  const { data: session } = useSession();
  const currentUserId = session?.user.id ?? -1;
  const apiUtils = api.useUtils();
  const debtsQuery = api.debts.getPair.useQuery({ friendId: friend.id, groupId, currency });
  const settleMutation = api.debts.settle.useMutation();
  const { toUIString } = getCurrencyHelpersCached(currency);

  const groups = useMemo(
    () => (debtsQuery.data ? debtorItemsByPriority(debtsQuery.data) : []),
    [debtsQuery.data],
  );
  const pending = useMemo(
    () => groups.flatMap((g) => g.items.filter((i) => 0n < i.remaining)),
    [groups],
  );
  const [selected, setSelected] = useState<Set<string>>(new Set());

  useEffect(() => {
    setSelected(new Set(pending.map((i) => i.expenseId)));
  }, [pending]);

  const total = pending
    .filter((i) => selected.has(i.expenseId))
    .reduce((sum, i) => sum + i.remaining, 0n);

  const toggleItem = useCallback((expenseId: string) => {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(expenseId)) {
        next.delete(expenseId);
      } else {
        next.add(expenseId);
      }
      return next;
    });
  }, []);

  const selectPriority = useCallback(
    (priority: DebtPriority | null) =>
      setSelected(
        new Set(
          pending
            .filter((i) => null === priority || i.priority === priority)
            .map((i) => i.expenseId),
        ),
      ),
    [pending],
  );

  const settle = useCallback(async () => {
    const expenseIds = pending.filter((i) => selected.has(i.expenseId)).map((i) => i.expenseId);
    try {
      await settleMutation.mutateAsync({
        friendId: friend.id,
        groupId,
        currency,
        expenseIds,
        expectedTotal: total,
        name: t('ui.settle_up_name'),
      });
      await apiUtils.invalidate();
      onDone();
    } catch (error) {
      if (error instanceof TRPCClientError && 'CONFLICT' === error.data?.code) {
        toast.error(t('debts.changed'));
        await debtsQuery.refetch();
        return;
      }
      toast.error(t('errors.saving_expense'));
    }
  }, [
    pending,
    selected,
    settleMutation,
    friend.id,
    groupId,
    currency,
    total,
    t,
    apiUtils,
    onDone,
    debtsQuery,
  ]);

  if (debtsQuery.isPending) {
    return (
      <div className="mt-10 flex justify-center">
        <LoadingSpinner className="text-primary" />
      </div>
    );
  }

  const data = debtsQuery.data;
  if (!data || null === data.debtorId || 0 === pending.length) {
    return fallback ? (
      <>{fallback}</>
    ) : (
      <p className="text-muted-foreground mt-6 text-center">{t('debts.even')}</p>
    );
  }

  const friendName = displayName(friend, currentUserId);

  return (
    <div className="flex flex-col gap-4 pb-2">
      <DebtSummary
        data={data}
        currency={currency}
        currentUserId={currentUserId}
        friendName={friendName}
      />

      <div className="flex flex-wrap gap-2" role="group" aria-label={t('debts.quick_select')}>
        <Button
          variant="outline"
          size="sm"
          className="h-11 rounded-full"
          onClick={() => selectPriority(null)}
        >
          {t('debts.all')}
        </Button>
        {groups.map((group) =>
          group.items.some((i) => 0n < i.remaining) ? (
            <Button
              key={group.priority}
              variant="outline"
              size="sm"
              className="h-11 rounded-full"
              onClick={() => selectPriority(group.priority)}
            >
              {t(`debts.priority.${group.priority}`)}
            </Button>
          ) : null,
        )}
      </div>

      <div className="flex flex-col gap-3">
        {groups
          .filter((group) => group.items.some((i) => 0n < i.remaining))
          .map((group) => (
            <section key={group.priority} aria-label={t(`debts.priority.${group.priority}`)}>
              <h3 className="text-muted-foreground mb-1 text-xs font-medium tracking-wide uppercase">
                {t(`debts.priority.${group.priority}`)}
              </h3>
              {group.items
                .filter((i) => 0n < i.remaining)
                .map((item) => {
                  const checkboxId = `debt-${item.expenseId}`;
                  return (
                    <label
                      key={item.expenseId}
                      htmlFor={checkboxId}
                      className={cn(
                        'hover:bg-muted/50 flex cursor-pointer items-center gap-3 rounded-md px-1',
                        !selected.has(item.expenseId) && 'opacity-70',
                      )}
                    >
                      <Checkbox
                        id={checkboxId}
                        checked={selected.has(item.expenseId)}
                        onCheckedChange={() => toggleItem(item.expenseId)}
                        className="size-5"
                      />
                      <div className="min-w-0 flex-1">
                        <DebtRow item={item} data={data} currency={currency} />
                      </div>
                    </label>
                  );
                })}
            </section>
          ))}
      </div>

      <div className="bg-background sticky bottom-0 flex flex-col gap-2 border-t pt-3">
        <p className="flex justify-between text-sm">
          <span className="text-muted-foreground">{t('debts.total')}</span>
          <span className="font-semibold tabular-nums">{toUIString(total)}</span>
        </p>
        <Button
          className="h-11"
          disabled={0n === total || settleMutation.isPending}
          onClick={() => {
            settle().catch(console.error);
          }}
        >
          {t('debts.register_payment', { amount: toUIString(total) })}
        </Button>
      </div>
    </div>
  );
};
