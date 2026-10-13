import { type GetServerSideProps } from 'next';
import Head from 'next/head';
import { useRouter } from 'next/router';
import { useCallback, useEffect } from 'react';
import { AddOrEditExpensePage } from '~/components/AddExpense/AddExpensePage';
import { useInitAddExpense } from '~/hooks/useInitAddExpense';
import MainLayout from '~/components/Layout/MainLayout';
import { env } from '~/env';
import { isBankConnectionConfigured } from '~/server/bankTransactionHelper';
import { type NextPageWithUser } from '~/types';
import { customServerSideTranslations } from '~/utils/i18n/server';
import { useTranslationWithUtils } from '~/hooks/useTranslationWithUtils';
import { useAppStore } from '~/store/appStore';
import { useApplyPrefill } from '~/hooks/useApplyPrefill';
import { useAddExpenseDialog } from '~/store/addExpenseDialogStore';
import { api } from '~/utils/api';

const AddPage: NextPageWithUser<{
  enableSendingInvites: boolean;
  bankConnectionEnabled: boolean;
  maxUploadFileSizeMB: number;
}> = ({ user, enableSendingInvites, bankConnectionEnabled, maxUploadFileSizeMB }) => {
  // TODO: Set this globally from env var with app router later
  const { setMaxUploadFileSizeMB } = useAppStore((s) => s.actions);
  setMaxUploadFileSizeMB(maxUploadFileSizeMB);

  const { t } = useTranslationWithUtils();
  const router = useRouter();
  const { friendId, groupId, expenseId } = router.query;
  const _expenseId = 'string' === typeof expenseId ? expenseId : undefined;
  const { currentUser, expenseQuery } = useInitAddExpense({
    user,
    groupId: 'string' === typeof groupId ? parseInt(groupId) : undefined,
    friendId: 'string' === typeof friendId ? parseInt(friendId) : undefined,
    expenseId: _expenseId,
    ready: router.isReady,
  });

  // Prefill and callbacks handed over by `openWith` on mobile (see addExpenseDialogStore).
  const prefill = useAddExpenseDialog((s) => (_expenseId ? null : s.prefill));
  const clearPrefill = useAddExpenseDialog((s) => s.close);
  const apiUtils = api.useUtils();
  useApplyPrefill(prefill, Boolean(currentUser));
  useEffect(() => clearPrefill, [clearPrefill]);

  const onSaved = useCallback(
    (savedId: string) => {
      prefill?.onSaved?.(savedId);
      apiUtils.invalidate().catch(console.error);
      router.back();
    },
    [prefill, apiUtils, router],
  );
  const onCancel = useCallback(() => {
    prefill?.onCancel?.();
    router.back();
  }, [prefill, router]);
  const hasCallbacks = Boolean(prefill?.onSaved ?? prefill?.onCancel);

  return (
    <>
      <Head>
        <title>{_expenseId ? t('actions.edit_expense') : t('actions.add_expense')}</title>
      </Head>
      <MainLayout hideAppBar>
        {currentUser && (!_expenseId || expenseQuery.data) && (
          <AddOrEditExpensePage
            enableSendingInvites={enableSendingInvites}
            expenseId={_expenseId}
            bankConnectionEnabled={Boolean(bankConnectionEnabled)}
            onSaved={hasCallbacks ? onSaved : undefined}
            onCancel={hasCallbacks ? onCancel : undefined}
          />
        )}
      </MainLayout>
    </>
  );
};

AddPage.auth = true;

export default AddPage;

export const getServerSideProps: GetServerSideProps = async (context) => ({
  props: {
    enableSendingInvites: Boolean(env.ENABLE_SENDING_INVITES),
    bankConnectionEnabled: isBankConnectionConfigured(),
    maxUploadFileSizeMB: env.UPLOAD_MAX_FILE_SIZE_MB,
    ...(await customServerSideTranslations(context.locale, ['common', 'categories', 'currencies'])),
  },
});
