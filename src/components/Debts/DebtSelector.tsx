import { type User } from '@prisma/client';
import { TRPCClientError } from '@trpc/client';
import { ChevronDownIcon } from 'lucide-react';
import { useSession } from 'next-auth/react';
import React, { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';

import { useTranslationWithUtils } from '~/hooks/useTranslationWithUtils';
import { type DebtItem } from '~/lib/debts';
import { cn } from '~/lib/utils';
import { api } from '~/utils/api';

import { Button } from '../ui/button';
import { Checkbox } from '../ui/checkbox';
import { Input } from '../ui/input';
import { LoadingSpinner } from '../ui/spinner';
import { DebtRow, type PairDebtsData, debtGroups, useCategoryName } from './DebtList';

const MAX_NAME = 100;

/** "Luz Agosto + Gas Julio", or "Pago comida y bebida" for variable debts. */
export const paymentName = (
  chosen: DebtItem[],
  data: PairDebtsData,
  sectionName: (section: string) => string,
  prefix: string,
) => {
  const fixed = chosen
    .filter((i) => 'fixed' === i.bucket.kind)
    .map((i) => data.expenses[i.expenseId]?.name ?? '');
  const sections = [
    ...new Set(chosen.flatMap((i) => ('variable' === i.bucket.kind ? [i.bucket.section] : []))),
  ].map((section) => sectionName(section).toLowerCase());
  const parts = [...fixed, ...(0 < sections.length ? [`${prefix} ${sections.join(', ')}`] : [])];
  const name = parts.filter(Boolean).join(' + ');
  return MAX_NAME < name.length ? `${name.slice(0, MAX_NAME - 1)}…` : name;
};

const CheckRow: React.FC<{
  item: DebtItem;
  data: PairDebtsData;
  currency: string;
  checked: boolean;
  onToggle: (expenseId: string) => void;
}> = ({ item, data, currency, checked, onToggle }) => {
  const checkboxId = `debt-${item.expenseId}`;
  return (
    <label
      htmlFor={checkboxId}
      className={cn(
        'hover:bg-muted/50 flex cursor-pointer items-center gap-3 rounded-md px-1',
        !checked && 'opacity-70',
      )}
    >
      <Checkbox
        id={checkboxId}
        checked={checked}
        onCheckedChange={() => onToggle(item.expenseId)}
        className="size-5"
      />
      <div className="min-w-0 flex-1">
        <DebtRow item={item} data={data} currency={currency} />
      </div>
    </label>
  );
};

const SectionCheck: React.FC<{
  section: string;
  items: DebtItem[];
  data: PairDebtsData;
  currency: string;
  selected: Set<string>;
  onToggle: (expenseId: string) => void;
  onToggleAll: (expenseIds: string[], checked: boolean) => void;
}> = ({ section, items, data, currency, selected, onToggle, onToggleAll }) => {
  const { t, getCurrencyHelpersCached } = useTranslationWithUtils();
  const categoryName = useCategoryName();
  const [open, setOpen] = useState(false);
  const id = useId();
  const ids = items.map((i) => i.expenseId);
  const count = ids.filter((expenseId) => selected.has(expenseId)).length;
  const total = items.reduce((sum, i) => sum + i.remaining, 0n);

  return (
    <div>
      <div className="flex items-center gap-3 px-1">
        <Checkbox
          id={id}
          className="size-5"
          checked={count === ids.length ? true : 0 === count ? false : 'indeterminate'}
          onCheckedChange={(value) => onToggleAll(ids, true === value)}
        />
        <label htmlFor={id} className="min-w-0 flex-1 cursor-pointer py-3">
          <span className="block truncate text-sm font-medium">{categoryName(section)}</span>
          <span className="text-muted-foreground block text-xs">
            {t('debts.expenses_count', { count: items.length })}
          </span>
        </label>
        <span className="text-sm font-semibold tabular-nums">
          {getCurrencyHelpersCached(currency).toUIString(total)}
        </span>
        <Button
          variant="ghost"
          size="icon"
          className="size-10"
          aria-expanded={open}
          aria-label={t('debts.show_expenses', { name: categoryName(section) })}
          onClick={() => setOpen((o) => !o)}
        >
          <ChevronDownIcon
            className={cn('size-4 transition-transform', open && 'rotate-180')}
            aria-hidden
          />
        </Button>
      </div>
      {open ? (
        <div className="border-border ml-4 border-l pl-2">
          {items.map((item) => (
            <CheckRow
              key={item.expenseId}
              item={item}
              data={data}
              currency={currency}
              checked={selected.has(item.expenseId)}
              onToggle={onToggle}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
};

/**
 * Registers a payment that covers the chosen debts of one member (either member can
 * register it). Fixed costs are listed one by one; variable ones by section. Renders
 * `fallback` when there are no per-expense debts (e.g. simplified groups).
 */
export const DebtSelector: React.FC<{
  friend: Pick<User, 'id' | 'name' | 'email' | 'image'>;
  groupId: number | null;
  currency: string;
  onDone: () => void;
  fallback?: React.ReactNode;
  /** Pre-selects only these debts (e.g. the "Settle" button of one fixed cost) */
  initialExpenseIds?: string[];
}> = ({ friend, groupId, currency, onDone, fallback, initialExpenseIds }) => {
  const { t, displayName, getCurrencyHelpersCached } = useTranslationWithUtils();
  const categoryName = useCategoryName();
  const { data: session } = useSession();
  const currentUserId = session?.user.id ?? -1;
  const apiUtils = api.useUtils();
  const debtsQuery = api.debts.getPair.useQuery({ friendId: friend.id, groupId, currency });
  const settleMutation = api.debts.settle.useMutation();
  const { toUIString } = getCurrencyHelpersCached(currency);
  const data = debtsQuery.data;
  const friendName = displayName(friend, currentUserId);

  const sides = useMemo(
    () =>
      data
        ? [currentUserId, friend.id].filter((userId) => 0n < (data.owed[userId]?.total ?? 0n))
        : [],
    [data, currentUserId, friend.id],
  );
  const [debtorId, setDebtorId] = useState<number | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [name, setName] = useState('');
  const [nameEdited, setNameEdited] = useState(false);

  const pendingOf = useCallback(
    (userId: number) =>
      data ? data.items.filter((i) => i.debtorId === userId && 0n < i.remaining) : [],
    [data],
  );

  // Choose the side and the initial selection once per loaded data.
  const initialisedFor = useRef<PairDebtsData | null>(null);
  useEffect(() => {
    if (!data || 0 === sides.length || initialisedFor.current === data) {
      return;
    }
    initialisedFor.current = data;
    const initial = initialExpenseIds?.length
      ? data.items.filter((i) => initialExpenseIds.includes(i.expenseId) && 0n < i.remaining)
      : [];
    const side =
      initial[0]?.debtorId ?? (sides.includes(currentUserId) ? currentUserId : sides[0]!);
    setDebtorId(side);
    setSelected(new Set((0 < initial.length ? initial : pendingOf(side)).map((i) => i.expenseId)));
  }, [data, sides, initialExpenseIds, currentUserId, pendingOf]);

  const pending = useMemo(
    () => (null === debtorId ? [] : pendingOf(debtorId)),
    [debtorId, pendingOf],
  );
  const groups = useMemo(
    () => (data && null !== debtorId ? debtGroups(data, debtorId) : { fixed: [], sections: [] }),
    [data, debtorId],
  );
  const chosen = useMemo(
    () => pending.filter((i) => selected.has(i.expenseId)),
    [pending, selected],
  );
  const total = chosen.reduce((sum, i) => sum + i.remaining, 0n);

  useEffect(() => {
    if (data && !nameEdited) {
      setName(paymentName(chosen, data, categoryName, t('debts.payment_prefix')));
    }
  }, [chosen, data, nameEdited, categoryName, t]);

  const toggle = useCallback((expenseId: string) => {
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

  const toggleAll = useCallback((expenseIds: string[], checked: boolean) => {
    setSelected((current) => {
      const next = new Set(current);
      expenseIds.forEach((expenseId) => (checked ? next.add(expenseId) : next.delete(expenseId)));
      return next;
    });
  }, []);

  const switchSide = useCallback(
    (userId: number) => {
      setDebtorId(userId);
      setSelected(new Set(pendingOf(userId).map((i) => i.expenseId)));
      setNameEdited(false);
    },
    [pendingOf],
  );

  const settle = useCallback(async () => {
    try {
      await settleMutation.mutateAsync({
        friendId: friend.id,
        groupId,
        currency,
        expenseIds: chosen.map((i) => i.expenseId),
        expectedTotal: total,
        name: name.trim() || t('ui.settle_up_name'),
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
    settleMutation,
    friend.id,
    groupId,
    currency,
    chosen,
    total,
    name,
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

  if (!data || 0 === sides.length || null === debtorId) {
    return fallback ? (
      <>{fallback}</>
    ) : (
      <p className="text-muted-foreground mt-6 text-center">{t('debts.even')}</p>
    );
  }

  const sideLabel = (userId: number) =>
    userId === currentUserId
      ? t('debts.you_owe_title', { name: friendName })
      : t('debts.owes_you_title', { name: friendName });

  return (
    <div className="flex flex-col gap-4 pb-2">
      {1 < sides.length ? (
        <div role="tablist" aria-label={t('debts.who_pays')} className="flex gap-2">
          {sides.map((userId) => (
            <button
              key={userId}
              type="button"
              role="tab"
              aria-selected={userId === debtorId}
              onClick={() => switchSide(userId)}
              className={cn(
                'min-h-11 flex-1 rounded-full border px-3 text-sm',
                userId === debtorId
                  ? 'border-primary bg-primary/15 font-medium'
                  : 'text-muted-foreground',
              )}
            >
              {sideLabel(userId)}
            </button>
          ))}
        </div>
      ) : (
        <p className="font-semibold">{sideLabel(debtorId)}</p>
      )}

      {0 < groups.fixed.length ? (
        <section aria-label={t('debts.fixed')}>
          <h3 className="text-muted-foreground mb-1 text-xs font-medium tracking-wide uppercase">
            {t('debts.fixed')}
          </h3>
          {groups.fixed.map((item) => (
            <CheckRow
              key={item.expenseId}
              item={item}
              data={data}
              currency={currency}
              checked={selected.has(item.expenseId)}
              onToggle={toggle}
            />
          ))}
        </section>
      ) : null}

      {0 < groups.sections.length ? (
        <section aria-label={t('debts.variable')}>
          <h3 className="text-muted-foreground mb-1 text-xs font-medium tracking-wide uppercase">
            {t('debts.variable')}
          </h3>
          {groups.sections.map(({ section, items }) => (
            <SectionCheck
              key={section}
              section={section}
              items={items}
              data={data}
              currency={currency}
              selected={selected}
              onToggle={toggle}
              onToggleAll={toggleAll}
            />
          ))}
        </section>
      ) : null}

      <div className="bg-background sticky bottom-0 flex flex-col gap-2 border-t pt-3">
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-muted-foreground">{t('debts.payment_name')}</span>
          <Input
            value={name}
            maxLength={MAX_NAME}
            onChange={(e) => {
              setName(e.target.value);
              setNameEdited(true);
            }}
            className="h-11"
          />
        </label>
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
