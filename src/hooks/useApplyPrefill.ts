import { useEffect, useRef } from 'react';

import { useTranslationWithUtils } from '~/hooks/useTranslationWithUtils';
import { parseCurrencyCode } from '~/lib/currency';
import { type AddExpensePrefill } from '~/store/addExpenseDialogStore';
import { useAddExpenseStore } from '~/store/addStore';

/** Applies the prefill once the group/friend context has been initialised. */
export const useApplyPrefill = (prefill: AddExpensePrefill | null, userReady: boolean) => {
  const { getCurrencyHelpersCached } = useTranslationWithUtils();
  const actions = useAddExpenseStore((s) => s.actions);
  const participants = useAddExpenseStore((s) => s.participants);
  const applied = useRef(false);
  const ready =
    userReady && (!prefill?.groupId && !prefill?.friendId ? true : 1 < participants.length);

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
