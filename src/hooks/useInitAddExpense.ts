import { type Session } from 'next-auth';
import { useEffect, useRef } from 'react';
import { toast } from 'sonner';

import { useTranslationWithUtils } from '~/hooks/useTranslationWithUtils';
import { cronFromBackend } from '~/lib/cron';
import { parseCurrencyCode } from '~/lib/currency';
import { deserializeDefaultSplit } from '~/lib/defaultSplit';
import { useAddExpenseStore } from '~/store/addStore';
import { api } from '~/utils/api';

/**
 * Initialises the add-expense store for a new expense (optionally in a group or with a friend)
 * or for editing one. Shared by the /add page and the global add dialog.
 */
export const useInitAddExpense = ({
  user,
  groupId,
  friendId,
  expenseId,
  ready = true,
}: {
  user: Session['user'];
  groupId?: number;
  friendId?: number;
  expenseId?: string;
  ready?: boolean;
}) => {
  const { t, getCurrencyHelpersCached } = useTranslationWithUtils();
  const {
    setCurrentUser,
    setGroup,
    setParticipants,
    setCurrency,
    setAmount,
    setDescription,
    setPaidBy,
    setAmountStr,
    setExpenseDate,
    setCategory,
    resetState,
    setCronExpression,
    setFileKey,
    applySplitPreset,
  } = useAddExpenseStore((s) => s.actions);
  const currentUser = useAddExpenseStore((s) => s.currentUser);
  const initializedGroupIdRef = useRef<number | null>(null);
  const initializedFriendIdRef = useRef<number | null>(null);
  const initializedExpenseIdRef = useRef<string | null>(null);

  useEffect(
    () => () => {
      resetState();
      initializedExpenseIdRef.current = null;
      initializedGroupIdRef.current = null;
      initializedFriendIdRef.current = null;
    },
    [resetState],
  );

  useEffect(() => {
    setCurrentUser({
      ...user,
      defaultCurrency: user.defaultCurrency ?? null,
      emailVerified: null,
      name: user.name ?? null,
      email: user.email ?? null,
      image: user.image ?? null,
      obapiProviderId: user.obapiProviderId ?? null,
      bankingId: user.bankingId ?? null,
    });
    if (ready && !groupId) {
      const preferredCurrency = user.currency ?? user.defaultCurrency;
      if (preferredCurrency) {
        setCurrency(parseCurrencyCode(preferredCurrency));
      }
    }
  }, [setCurrentUser, setCurrency, groupId, ready, user]);

  const _groupId = groupId ?? NaN;
  const _friendId = friendId ?? NaN;
  const _expenseId = expenseId ?? '';
  const groupQuery = api.group.getGroupDetails.useQuery(
    { groupId: _groupId },
    {
      enabled: Boolean(_groupId) && !_expenseId,
      refetchOnReconnect: false,
      refetchOnWindowFocus: false,
    },
  );

  const friendQuery = api.user.getFriend.useQuery(
    { friendId: _friendId },
    {
      enabled: Boolean(_friendId) && !_expenseId,
      refetchOnReconnect: false,
      refetchOnWindowFocus: false,
    },
  );

  const expenseQuery = api.expense.getExpenseDetails.useQuery(
    { expenseId: _expenseId },
    {
      enabled: Boolean(_expenseId),
      refetchOnReconnect: false,
      refetchOnWindowFocus: false,
    },
  );

  useEffect(() => {
    if (!groupId || !_groupId) {
      initializedGroupIdRef.current = null;
      return;
    }

    if (initializedGroupIdRef.current === _groupId) {
      return;
    }

    // Set group
    if (groupId && !groupQuery.isPending && groupQuery.data && currentUser) {
      initializedGroupIdRef.current = _groupId;
      setGroup(groupQuery.data);

      setParticipants([
        currentUser,
        ...groupQuery.data.groupUsers
          .map((gu) => gu.user)
          .filter((groupUser) => groupUser.id !== currentUser.id),
      ]);
      const preferredCurrency =
        currentUser.currency ?? groupQuery.data.defaultCurrency ?? currentUser.defaultCurrency;
      if (preferredCurrency) {
        setCurrency(parseCurrencyCode(preferredCurrency));
      }
      const parsedDefaultSplit = deserializeDefaultSplit(groupQuery.data.defaultSplit);
      if (parsedDefaultSplit) {
        applySplitPreset(parsedDefaultSplit.splitType, parsedDefaultSplit.shares);
      }
      useAddExpenseStore.setState({ showFriends: false });
    }
  }, [
    _groupId,
    groupId,
    groupQuery.isPending,
    groupQuery.data,
    currentUser,
    setGroup,
    setParticipants,
    setCurrency,
    applySplitPreset,
  ]);

  useEffect(() => {
    if (!friendId || !_friendId) {
      initializedFriendIdRef.current = null;
      return;
    }

    if (initializedFriendIdRef.current === _friendId) {
      return;
    }

    if (friendId && currentUser && friendQuery.data) {
      initializedFriendIdRef.current = _friendId;
      setParticipants([currentUser, friendQuery.data]);
      const parsedDefaultSplit = deserializeDefaultSplit(friendQuery.data.defaultSplit);
      if (parsedDefaultSplit) {
        applySplitPreset(parsedDefaultSplit.splitType, parsedDefaultSplit.shares);
      }
      useAddExpenseStore.setState({ showFriends: false });
    }
  }, [
    _friendId,
    friendId,
    friendQuery.isPending,
    friendQuery.data,
    currentUser,
    setParticipants,
    applySplitPreset,
  ]);

  useEffect(() => {
    if (!_expenseId || !expenseQuery.data) {
      initializedExpenseIdRef.current = null;
      return;
    }

    if (initializedExpenseIdRef.current === _expenseId) {
      return;
    }

    initializedExpenseIdRef.current = _expenseId;

    if (expenseQuery.data.group) {
      setGroup(expenseQuery.data.group);
    }
    setPaidBy(expenseQuery.data.paidByUser);
    setCurrency(parseCurrencyCode(expenseQuery.data.currency));
    setAmountStr(
      getCurrencyHelpersCached(expenseQuery.data.currency).toUIString(
        expenseQuery.data.amount,
        true,
        true,
      ),
    );
    setDescription(expenseQuery.data.name);
    setCategory(expenseQuery.data.category);
    setAmount(expenseQuery.data.amount);
    setParticipants(
      expenseQuery.data.expenseParticipants.map((ep) => ({
        ...ep.user,
        amount: ep.amount,
      })),
      expenseQuery.data.splitType,
    );
    useAddExpenseStore.setState({ showFriends: false });
    setExpenseDate(expenseQuery.data.expenseDate);
    if (expenseQuery.data.recurrence) {
      try {
        const cronExpression = cronFromBackend(expenseQuery.data.recurrence.job.schedule);
        setCronExpression(cronExpression);
      } catch {
        toast.error(t('errors.invalid_cron_expression'));
        console.error(
          `Failed to parse cron expression for expense: ${expenseQuery.data.recurrence.job.schedule}`,
        );
      }
    }
    if (expenseQuery.data.fileKey) {
      setFileKey(expenseQuery.data.fileKey);
    }
  }, [
    _expenseId,
    _friendId,
    _groupId,
    friendId,
    expenseQuery.data,
    groupId,
    friendQuery.data,
    friendQuery.isPending,
    groupQuery.data,
    groupQuery.isPending,
    currentUser,
    setAmount,
    setAmountStr,
    setCategory,
    setCurrency,
    setDescription,
    setExpenseDate,
    setGroup,
    setPaidBy,
    setParticipants,
    setCronExpression,
    setFileKey,
    getCurrencyHelpersCached,
    t,
  ]);

  return { currentUser, expenseQuery, isEditing: Boolean(_expenseId) };
};
