import Router from 'next/router';
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
  /** Called when the form is closed without saving */
  onCancel?: () => void;
}

interface AddExpenseDialogState {
  open: boolean;
  prefill: AddExpensePrefill | null;
  openWith: (prefill?: AddExpensePrefill) => void;
  close: () => void;
}

/** Same breakpoint as the mobile layout (bottom navigation below `lg`). */
export const isMobileViewport = () =>
  'undefined' !== typeof window && window.matchMedia('(max-width: 1023px)').matches;

/**
 * Global "add expense" form, openable from any screen: a dialog on desktop and
 * the full /add page on mobile, where a long dialog cannot scroll comfortably.
 * On mobile the prefill stays here for the page to pick up.
 */
export const useAddExpenseDialog = create<AddExpenseDialogState>((set) => ({
  open: false,
  prefill: null,
  openWith: (prefill) => {
    if (!isMobileViewport()) {
      set({ open: true, prefill: prefill ?? null });
      return;
    }
    set({ open: false, prefill: prefill ?? null });
    const query = {
      ...(prefill?.groupId && { groupId: String(prefill.groupId) }),
      ...(prefill?.friendId && { friendId: String(prefill.friendId) }),
    };
    Router.push({ pathname: '/add', query }).catch(console.error);
  },
  close: () => set({ open: false, prefill: null }),
}));
