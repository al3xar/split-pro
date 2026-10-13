import { PlusIcon } from 'lucide-react';
import { useTranslation } from 'next-i18next';
import React from 'react';

import { type AddExpensePrefill, useAddExpenseDialog } from '~/store/addExpenseDialogStore';

/** Floating "+" that opens the add dialog with the screen's group or friend preselected. */
export const AddExpenseFab: React.FC<Pick<AddExpensePrefill, 'groupId' | 'friendId'>> = ({
  groupId,
  friendId,
}) => {
  const { t } = useTranslation();
  const openWith = useAddExpenseDialog((s) => s.openWith);
  return (
    <button
      type="button"
      onClick={() => openWith({ groupId, friendId })}
      aria-label={t('actions.add_expense')}
      className="bg-primary text-primary-foreground fixed right-4 bottom-24 z-40 flex size-14 items-center justify-center rounded-full shadow-lg transition-transform hover:scale-105 lg:bottom-8"
    >
      <PlusIcon className="size-7" aria-hidden />
    </button>
  );
};
