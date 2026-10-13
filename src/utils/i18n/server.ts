import { type SSRConfig } from 'next-i18next';
import { serverSideTranslations } from 'next-i18next/serverSideTranslations';
import i18nConfig from '@/next-i18next.config.js';

export const customServerSideTranslations = async (
  locale: string | undefined,
  namespaces: string[],
): Promise<SSRConfig> => {
  locale ??= 'en';
  // The global add-expense dialog can open on any page and needs these namespaces.
  const all = [...new Set([...namespaces, 'common', 'categories', 'currencies'])];
  return await serverSideTranslations(locale, all, i18nConfig);
};

export const withI18nStaticProps =
  (namespaces: string[] = ['common']) =>
  async ({ locale }: { locale: string }) => ({
    props: {
      ...(await customServerSideTranslations(locale, namespaces)),
    },
  });
