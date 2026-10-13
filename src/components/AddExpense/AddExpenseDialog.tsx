import { type Session } from 'next-auth';
import React, { useCallback, useEffect, useRef } from 'react';

import { useInitAddExpense } from '~/hooks/useInitAddExpense';
import { useTranslationWithUtils } from '~/hooks/useTranslationWithUtils';
import { parseCurrencyCode } from '~/lib/currency';
import { type AddExpensePrefill, useAddExpenseDialog } from '~/store/addExpenseDialogStore';
import { useAddExpenseStore } from '~/store/addStore';
import { useAppStore } from '~/store/appStore';
import { api } from '~/utils/api';

import { Dialog, DialogContent, DialogTitle } from '../ui/dialog';
import { AddOrEditExpensePage } from './AddExpensePage';

/** Applies the prefill once the group/friend context has been initialised. */
const usePrefill = (prefill: AddExpensePrefill | null, ready: boolean) => {
  const { getCurrencyHelpersCached } = useTranslationWithUtils();
  const actions = useAddExpenseStore((s) => s.actions);
  const participants = useAddExpenseStore((s) => s.participants);
  const applied = useRef(false);

  useEffect(() => {
    if (!prefill || !ready || applied.current) {
      return;
    }
    applied.current = true;
    if (prefill.currency) {
      actions.setCurrency(parseCurrencyCode(prefill.currency));
    }
    if (prefill.name) {
      actions.setDescription(prefill.name);
    }
    if (prefill.category) {
      actions.setCategory(prefill.category);
    }
    if (prefill.expenseDate) {
      actions.setExpenseDate(prefill.expenseDate);
    }
    if (undefined !== prefill.amount) {
      const currency = prefill.currency ?? useAddExpenseStore.getState().currency;
      actions.setAmount(prefill.amount);
      actions.setAmountStr(
        getCurrencyHelpersCached(currency).toUIString(prefill.amount, false, true),
      );
    }
    const payer = participants.find((p) => p.id === prefill.paidById);
    if (payer) {
      actions.setPaidBy(payer);
    }
  }, [prefill, ready, actions, participants, getCurrencyHelpersCached]);
};

const DialogBody: React.FC<{
  user: Session['user'];
  prefill: AddExpensePrefill | null;
  onDone: (saved: boolean, expenseId?: string) => void;
}> = ({ user, prefill, onDone }) => {
  const configQuery = api.expense.getAddConfig.useQuery();
  const { setMaxUploadFileSizeMB } = useAppStore((s) => s.actions);
  const { currentUser } = useInitAddExpense({
    user,
    groupId: prefill?.groupId,
    friendId: prefill?.friendId,
  });
  const participantsCount = useAddExpenseStore((s) => s.participants.length);
  const contextReady =
    Boolean(currentUser) &&
    (!prefill?.groupId && !prefill?.friendId ? true : 1 < participantsCount);
  usePrefill(prefill, contextReady);

  useEffect(() => {
    if (configQuery.data) {
      setMaxUploadFileSizeMB(configQuery.data.maxUploadFileSizeMB);
    }
  }, [configQuery.data, setMaxUploadFileSizeMB]);

  if (!currentUser || !configQuery.data) {
    return null;
  }
  return (
    <AddOrEditExpensePage
      enableSendingInvites={configQuery.data.enableSendingInvites}
      bankConnectionEnabled={configQuery.data.bankConnectionEnabled}
      onSaved={(id) => onDone(true, id)}
      onCancel={() => onDone(false)}
    />
  );
};

/** The add-expense form as a dialog above any screen. Mounted once in _app. */
export const AddExpenseDialog: React.FC<{ user: Session['user'] }> = ({ user }) => {
  const { t } = useTranslationWithUtils();
  const { open, prefill, close } = useAddExpenseDialog();
  const apiUtils = api.useUtils();

  const onDone = useCallback(
    (saved: boolean, expenseId?: string) => {
      if (saved && expenseId) {
        prefill?.onSaved?.(expenseId);
        apiUtils.invalidate().catch(console.error);
      } else {
        prefill?.onCancel?.();
      }
      close();
    },
    [prefill, close, apiUtils],
  );

  const onOpenChange = useCallback(
    (next: boolean) => {
      if (!next) {
        onDone(false);
      }
    },
    [onDone],
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="flex max-h-[92dvh] w-[calc(100%-1rem)] flex-col overflow-y-auto p-4 sm:max-w-xl sm:p-6"
        aria-describedby={undefined}
        showCloseButton={false}
        onInteractOutside={(e) => e.preventDefault()}
      >
        <DialogTitle className="sr-only">{t('actions.add_expense')}</DialogTitle>
        {open ? <DialogBody user={user} prefill={prefill} onDone={onDone} /> : null}
      </DialogContent>
    </Dialog>
  );
};
