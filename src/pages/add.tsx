import { type GetServerSideProps } from 'next';
import Head from 'next/head';
import { useRouter } from 'next/router';
import { AddOrEditExpensePage } from '~/components/AddExpense/AddExpensePage';
import { useInitAddExpense } from '~/hooks/useInitAddExpense';
import MainLayout from '~/components/Layout/MainLayout';
import { env } from '~/env';
import { isBankConnectionConfigured } from '~/server/bankTransactionHelper';
import { type NextPageWithUser } from '~/types';
import { customServerSideTranslations } from '~/utils/i18n/server';
import { useTranslationWithUtils } from '~/hooks/useTranslationWithUtils';
import { useAppStore } from '~/store/appStore';

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
