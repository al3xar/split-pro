import { SplitType, type User } from '@prisma/client';
import { ArrowRightIcon } from 'lucide-react';
import React, { type ReactNode, useState } from 'react';
import { toast } from 'sonner';
import { useTranslationWithUtils } from '~/hooks/useTranslationWithUtils';
import { DEFAULT_CATEGORY } from '~/lib/category';
import { api } from '~/utils/api';
import { BigMath } from '~/utils/numbers';

import { DebtSelector } from '../Debts/DebtSelector';
import { EntityAvatar } from '../ui/avatar';
import { Button } from '../ui/button';
import { CurrencyInput } from '../ui/currency-input';
import { AppDrawer } from '../ui/drawer';
import { useSession } from 'next-auth/react';

export const GroupSettleUp: React.FC<{
  amount: bigint;
  currency: string;
  friend: User;
  user: User;
  children: ReactNode;
  groupId: number;
}> = ({ amount: _amount, currency, friend, user, children, groupId }) => {
  const { data } = useSession();
  const { displayName, t, getCurrencyHelpersCached } = useTranslationWithUtils();
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState<bigint>(BigMath.abs(_amount));
  const [amountStr, setAmountStr] = useState(getCurrencyHelpersCached(currency).toUIString(amount));

  const onCurrencyInputValueChange = React.useCallback(
    ({ strValue, bigIntValue }: { strValue?: string; bigIntValue?: bigint }) => {
      if (strValue !== undefined) {
        setAmountStr(strValue);
      }
      if (bigIntValue !== undefined) {
        setAmount(bigIntValue);
      }
    },
    [],
  );

  const addExpenseMutation = api.expense.addOrEditExpense.useMutation();
  const utils = api.useUtils();

  const sender = 0 > _amount ? user : friend;
  const receiver = 0 > _amount ? friend : user;

  const saveExpense = React.useCallback(() => {
    if (!amount) {
      return;
    }

    addExpenseMutation.mutate(
      {
        name: t('ui.settle_up_name'),
        currency: currency,
        amount,
        splitType: SplitType.SETTLEMENT,
        groupId,
        participants: [
          {
            userId: sender.id,
            amount,
          },
          {
            userId: receiver.id,
            amount: -amount,
          },
        ],
        paidBy: sender.id,
        category: DEFAULT_CATEGORY,
      },
      {
        onSuccess: () => {
          utils.group.invalidate().catch(console.error);
          utils.debts.invalidate().catch(console.error);
          setOpen(false);
        },
        onError: (error) => {
          console.error('Error while saving expense:', error);
          toast.error(t('errors.saving_expense'));
        },
      },
    );
  }, [sender, receiver, amount, utils, addExpenseMutation, currency, groupId, t]);

  return (
    <AppDrawer
      trigger={children}
      open={open}
      onOpenChange={setOpen}
      leftAction={t('actions.back')}
      title={t('ui.settlement')}
      className="h-[70vh]"
    >
      <DebtSelector
        friend={user.id === data?.user.id ? friend : user}
        groupId={groupId}
        currency={currency}
        onDone={() => setOpen(false)}
        fallback={
          <div className="mt-10 flex flex-col items-center gap-6">
            <div className="flex flex-col items-center">
              <div className="flex items-center gap-5">
                <EntityAvatar entity={sender} />
                <ArrowRightIcon className="h-6 w-6 text-gray-600" />
                <EntityAvatar entity={receiver} />
              </div>
              <p className="mt-2 text-center text-sm text-gray-400">
                {displayName(sender, data?.user.id)}{' '}
                {t(`ui.expense.${sender.id === data?.user.id ? 'you' : 'user'}.pay`)}{' '}
                {displayName(receiver, data?.user.id)}
              </p>
            </div>
            <CurrencyInput
              currency={currency}
              strValue={amountStr}
              className="mx-auto mt-4 w-[150px] text-center text-lg"
              onValueChange={onCurrencyInputValueChange}
            />
            <Button className="h-11 w-full" disabled={!amount} onClick={saveExpense}>
              {t('actions.save')}
            </Button>
          </div>
        }
      />
    </AppDrawer>
  );
};
