import React from 'react';

import { type AddExpensePrefill, useAddExpenseDialog } from '~/store/addExpenseDialogStore';

/** Makes its single child (usually a Button) open the global add dialog. */
export const AddExpenseTrigger: React.FC<{
  prefill?: AddExpensePrefill;
  children: React.ReactElement<{ onClick?: React.MouseEventHandler }>;
}> = ({ prefill, children }) => {
  const openWith = useAddExpenseDialog((s) => s.openWith);
  return React.cloneElement(children, { onClick: () => openWith(prefill) });
};
