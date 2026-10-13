import { CheckCircle2Icon, ChevronLeftIcon, FileUpIcon } from 'lucide-react';
import Head from 'next/head';
import Link from 'next/link';
import React, { useCallback, useId, useMemo, useState } from 'react';
import { toast } from 'sonner';

import MainLayout from '~/components/Layout/MainLayout';
import { Button } from '~/components/ui/button';
import { Input } from '~/components/ui/input';
import { NativeSelect, NativeSelectOption } from '~/components/ui/native-select';
import { useTranslationWithUtils } from '~/hooks/useTranslationWithUtils';
import {
  type DateFormat,
  type ParsedCsv,
  type StatementMapping,
  detectMapping,
  parseCsv,
  toTransactions,
} from '~/lib/statement';
import { type NextPageWithUser } from '~/types';
import { api } from '~/utils/api';
import { withI18nStaticProps } from '~/utils/i18n/server';

const DATE_FORMATS: DateFormat[] = ['dd/MM/yyyy', 'dd-MM-yyyy', 'dd.MM.yyyy', 'yyyy-MM-dd', 'iso'];

/** Spanish banks often export Windows-1252; fall back to it when UTF-8 shows replacement chars. */
const readText = async (file: File) => {
  const buffer = await file.arrayBuffer();
  const utf8 = new TextDecoder('utf-8').decode(buffer);
  return utf8.includes('�') ? new TextDecoder('windows-1252').decode(buffer) : utf8;
};

type Mapping = StatementMapping & { defaultCurrency: string };

const ColumnSelect: React.FC<{
  label: string;
  value: number | null;
  headers: string[];
  optional?: boolean;
  onChange: (value: number | null) => void;
}> = ({ label, value, headers, optional, onChange }) => {
  const id = useId();
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="text-sm font-medium">
        {label}
      </label>
      <NativeSelect
        id={id}
        className="h-11 w-full"
        value={null === value ? '' : String(value)}
        onChange={(e) => onChange('' === e.target.value ? null : Number(e.target.value))}
      >
        {optional ? <NativeSelectOption value="">—</NativeSelectOption> : null}
        {headers.map((header, index) => (
          <NativeSelectOption key={`${header}-${index}`} value={String(index)}>
            {header || `#${index + 1}`}
          </NativeSelectOption>
        ))}
      </NativeSelect>
    </div>
  );
};

const BankImportPage: NextPageWithUser = () => {
  const { t, toUIDate, getCurrencyHelpersCached } = useTranslationWithUtils();
  const fileId = useId();
  const profileNameId = useId();
  const [parsed, setParsed] = useState<ParsedCsv | null>(null);
  const [mapping, setMapping] = useState<Mapping | null>(null);
  const [profileName, setProfileName] = useState('');
  const [result, setResult] = useState<{ created: number; duplicates: number } | null>(null);

  const contextQuery = api.inbox.context.useQuery();
  const profilesQuery = api.inbox.profiles.useQuery();
  const saveProfileMutation = api.inbox.saveProfile.useMutation();
  const importMutation = api.inbox.importRows.useMutation();
  const apiUtils = api.useUtils();

  const onFile = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) {
        return;
      }
      setResult(null);
      const csv = parseCsv(await readText(file));
      if (0 === csv.rows.length) {
        toast.error(t('bank_import.empty_file'));
        return;
      }
      setParsed(csv);
      const saved = profilesQuery.data?.[0];
      const detected = detectMapping(csv);
      const savedMapping = saved?.mapping as Mapping | undefined;
      const fits = savedMapping && savedMapping.date < csv.headers.length;
      setMapping(
        fits
          ? savedMapping
          : { ...detected, defaultCurrency: contextQuery.data?.defaultCurrency ?? 'EUR' },
      );
      setProfileName(fits && saved ? saved.name : file.name.replace(/\.[^.]+$/, ''));
    },
    [profilesQuery.data, contextQuery.data?.defaultCurrency, t],
  );

  const transactions = useMemo(
    () => (parsed && mapping ? toTransactions(parsed, mapping, mapping.defaultCurrency) : []),
    [parsed, mapping],
  );

  const update = (changes: Partial<Mapping>) =>
    setMapping((current) => (current ? { ...current, ...changes } : current));

  const runImport = useCallback(async () => {
    if (!mapping || 0 === transactions.length) {
      return;
    }
    try {
      const name = profileName.trim() || t('bank_import.default_profile');
      await saveProfileMutation.mutateAsync({ name, mapping });
      const data = await importMutation.mutateAsync({ source: name, rows: transactions });
      setResult(data);
      await apiUtils.inbox.invalidate();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('bank_import.error'));
    }
  }, [mapping, transactions, profileName, saveProfileMutation, importMutation, apiUtils, t]);

  return (
    <>
      <Head>
        <title>{t('bank_import.title')}</title>
      </Head>
      <MainLayout
        title={
          <div className="flex items-center gap-1">
            <Button variant="ghost" size="icon" className="size-11" asChild>
              <Link href="/account" aria-label={t('navigation.account')}>
                <ChevronLeftIcon className="size-6" aria-hidden />
              </Link>
            </Button>
            <h1 className="text-xl font-semibold">{t('bank_import.title')}</h1>
          </div>
        }
      >
        <div className="flex flex-col gap-4">
          {result ? (
            <section
              className="bg-card flex flex-col items-center gap-3 rounded-xl border p-6 text-center"
              role="status"
            >
              <CheckCircle2Icon className="text-positive size-10" aria-hidden />
              <p className="font-semibold">
                {t('bank_import.done', { created: result.created, duplicates: result.duplicates })}
              </p>
              <Button asChild className="h-11">
                <Link href="/inbox">{t('bank_import.go_inbox')}</Link>
              </Button>
            </section>
          ) : null}

          <section className="bg-card flex flex-col gap-3 rounded-xl border p-4">
            <label htmlFor={fileId} className="text-sm font-medium">
              {t('bank_import.file_label')}
            </label>
            <p className="text-muted-foreground text-xs">{t('bank_import.file_hint')}</p>
            <label
              htmlFor={fileId}
              className="hover:bg-muted/50 flex min-h-20 cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border border-dashed p-4 text-sm"
            >
              <FileUpIcon className="text-muted-foreground size-6" aria-hidden />
              {t('bank_import.choose_file')}
            </label>
            <input
              id={fileId}
              type="file"
              accept=".csv,text/csv,text/plain"
              className="sr-only"
              onChange={(e) => {
                onFile(e).catch(console.error);
              }}
            />
          </section>

          {parsed && mapping ? (
            <>
              <section className="bg-card flex flex-col gap-3 rounded-xl border p-4">
                <h2 className="text-base font-semibold">{t('bank_import.columns')}</h2>
                <div className="grid gap-3 sm:grid-cols-2">
                  <ColumnSelect
                    label={t('bank_import.date')}
                    value={mapping.date}
                    headers={parsed.headers}
                    onChange={(v) => update({ date: v ?? 0 })}
                  />
                  <ColumnSelect
                    label={t('bank_import.description')}
                    value={mapping.description}
                    headers={parsed.headers}
                    onChange={(v) => update({ description: v ?? 0 })}
                  />
                  <ColumnSelect
                    label={t('bank_import.amount')}
                    value={mapping.amount}
                    headers={parsed.headers}
                    optional
                    onChange={(v) => update({ amount: v })}
                  />
                  {null === mapping.amount ? (
                    <>
                      <ColumnSelect
                        label={t('bank_import.debit')}
                        value={mapping.debit}
                        headers={parsed.headers}
                        optional
                        onChange={(v) => update({ debit: v })}
                      />
                      <ColumnSelect
                        label={t('bank_import.credit')}
                        value={mapping.credit}
                        headers={parsed.headers}
                        optional
                        onChange={(v) => update({ credit: v })}
                      />
                    </>
                  ) : null}
                  <ColumnSelect
                    label={t('bank_import.currency')}
                    value={mapping.currency}
                    headers={parsed.headers}
                    optional
                    onChange={(v) => update({ currency: v })}
                  />
                  <label className="flex flex-col gap-1 text-sm font-medium">
                    {t('bank_import.date_format')}
                    <NativeSelect
                      className="h-11 w-full"
                      value={mapping.dateFormat}
                      onChange={(e) => update({ dateFormat: e.target.value as DateFormat })}
                    >
                      {DATE_FORMATS.map((f) => (
                        <NativeSelectOption key={f} value={f}>
                          {f}
                        </NativeSelectOption>
                      ))}
                    </NativeSelect>
                  </label>
                  <label className="flex flex-col gap-1 text-sm font-medium">
                    {t('bank_import.decimal')}
                    <NativeSelect
                      className="h-11 w-full"
                      value={mapping.decimal}
                      onChange={(e) => update({ decimal: e.target.value as ',' | '.' })}
                    >
                      <NativeSelectOption value=",">1.234,56</NativeSelectOption>
                      <NativeSelectOption value=".">1,234.56</NativeSelectOption>
                    </NativeSelect>
                  </label>
                </div>
                <div className="flex flex-col gap-1">
                  <label htmlFor={profileNameId} className="text-sm font-medium">
                    {t('bank_import.profile_name')}
                  </label>
                  <Input
                    id={profileNameId}
                    value={profileName}
                    onChange={(e) => setProfileName(e.target.value)}
                    className="h-11"
                    maxLength={60}
                  />
                </div>
              </section>

              <section className="bg-card rounded-xl border p-4">
                <h2 className="mb-2 text-base font-semibold">
                  {t('bank_import.preview', { count: transactions.length })}
                </h2>
                <ul className="divide-border divide-y text-sm">
                  {transactions.slice(0, 8).map((tx) => (
                    <li key={tx.hash} className="flex items-center justify-between gap-3 py-2">
                      <span className="min-w-0">
                        <span className="block truncate">{tx.description}</span>
                        <span className="text-muted-foreground text-xs">{toUIDate(tx.date)}</span>
                      </span>
                      <span
                        className={
                          0n > tx.amount
                            ? 'text-negative shrink-0 tabular-nums'
                            : 'text-positive shrink-0 tabular-nums'
                        }
                      >
                        {getCurrencyHelpersCached(tx.currency).toUIString(tx.amount, true)}
                      </span>
                    </li>
                  ))}
                </ul>
                <Button
                  className="mt-3 h-11 w-full"
                  disabled={0 === transactions.length || importMutation.isPending}
                  onClick={() => {
                    runImport().catch(console.error);
                  }}
                >
                  {t('bank_import.import', { count: transactions.length })}
                </Button>
              </section>
            </>
          ) : null}
        </div>
      </MainLayout>
    </>
  );
};

BankImportPage.auth = true;

export const getStaticProps = withI18nStaticProps(['common']);

export default BankImportPage;
