import { create } from 'zustand';

export interface AddExpensePrefill {
  groupId?: number;
  friendId?: number;
  name?: string;
  /** Positive amount in minor units */
  amount?: bigint;
  currency?: string;
  category?: string;
  paidById?: number;
  expenseDate?: Date;
  /** Called with the new expense id once it is saved */
  onSaved?: (expenseId: string) => void;
  /** Called when the dialog is closed without saving */
  onCancel?: () => void;
}

interface AddExpenseDialogState {
  open: boolean;
  prefill: AddExpensePrefill | null;
  openWith: (prefill?: AddExpensePrefill) => void;
  close: () => void;
}

/** Global "add expense" dialog, openable from any screen. */
export const useAddExpenseDialog = create<AddExpenseDialogState>((set) => ({
  open: false,
  prefill: null,
  openWith: (prefill) => set({ open: true, prefill: prefill ?? null }),
  close: () => set({ open: false, prefill: null }),
}));
