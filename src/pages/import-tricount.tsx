import { TRPCClientError } from '@trpc/client';
import { CheckCircle2Icon, ChevronLeftIcon, DownloadIcon } from 'lucide-react';
import { useSession } from 'next-auth/react';
import Head from 'next/head';
import Link from 'next/link';
import React, { useCallback, useId, useMemo, useState } from 'react';

import MainLayout from '~/components/Layout/MainLayout';
import { Button } from '~/components/ui/button';
import { Checkbox } from '~/components/ui/checkbox';
import { Input } from '~/components/ui/input';
import { NativeSelect, NativeSelectOption } from '~/components/ui/native-select';
import { useTranslationWithUtils } from '~/hooks/useTranslationWithUtils';
import { type NextPageWithUser } from '~/types';
import { type RouterOutputs, api } from '~/utils/api';
import { withI18nStaticProps } from '~/utils/i18n/server';

type Preview = RouterOutputs['tricount']['preview'];
/** "me", a friend's email, or "new" (type an email). */
type Choice = { kind: 'me' } | { kind: 'friend'; email: string } | { kind: 'new'; email: string };

const KNOWN_ERRORS = new Set([
  'INVALID_LINK',
  'TRICOUNT_NOT_FOUND',
  'TRICOUNT_UNAVAILABLE',
  'TRICOUNT_FORMAT_CHANGED',
  'UNMAPPED_MEMBERS',
  'ONE_MEMBER_MUST_BE_YOU',
  'EMAIL_REQUIRED',
]);

const errorKey = (error: unknown) =>
  error instanceof TRPCClientError && KNOWN_ERRORS.has(error.message)
    ? `tricount.errors.${error.message}`
    : 'tricount.errors.generic';

const ImportTricountPage: NextPageWithUser = () => {
  const { t, toUIDate, getCurrencyHelpersCached } = useTranslationWithUtils();
  const { data: session } = useSession();
  const linkId = useId();
  const groupNameId = useId();
  const [link, setLink] = useState('');
  const [preview, setPreview] = useState<Preview | null>(null);
  const [choices, setChoices] = useState<Record<string, Choice>>({});
  const [groupName, setGroupName] = useState('');
  const [household, setHousehold] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<RouterOutputs['tricount']['import'] | null>(null);

  const friendsQuery = api.user.getFriends.useQuery();
  const previewMutation = api.tricount.preview.useMutation();
  const importMutation = api.tricount.import.useMutation();
  const apiUtils = api.useUtils();

  const friends = useMemo(
    () =>
      (friendsQuery.data ?? []).filter((f): f is typeof f & { email: string } => Boolean(f.email)),
    [friendsQuery.data],
  );

  const loadPreview = useCallback(async () => {
    setError(null);
    setResult(null);
    try {
      const data = await previewMutation.mutateAsync({ link });
      setPreview(data);
      setGroupName(data.existingGroup?.name ?? data.title);
      const myName = session?.user.name?.toLowerCase();
      setChoices(
        Object.fromEntries(
          data.members.map((member) => {
            const friend = friends.find((f) => f.name?.toLowerCase() === member.toLowerCase());
            const choice: Choice =
              myName && member.toLowerCase() === myName
                ? { kind: 'me' }
                : friend
                  ? { kind: 'friend', email: friend.email }
                  : { kind: 'new', email: '' };
            return [member, choice];
          }),
        ),
      );
    } catch (e) {
      setPreview(null);
      setError(errorKey(e));
    }
  }, [link, previewMutation, session?.user.name, friends]);

  const meCount = Object.values(choices).filter((c) => 'me' === c.kind).length;
  const missingEmail = Object.values(choices).some(
    (c) => 'new' === c.kind && !/^\S+@\S+\.\S+$/.test(c.email),
  );
  const canImport = preview && 1 === meCount && !missingEmail && '' !== groupName.trim();

  const runImport = useCallback(async () => {
    if (!preview) {
      return;
    }
    setError(null);
    try {
      const data = await importMutation.mutateAsync({
        link,
        groupName: groupName.trim(),
        household,
        members: preview.members.map((name) => {
          const choice = choices[name]!;
          return 'me' === choice.kind
            ? { name, isMe: true }
            : { name, isMe: false, email: choice.email };
        }),
      });
      setResult(data);
      await apiUtils.invalidate();
    } catch (e) {
      setError(errorKey(e));
    }
  }, [preview, importMutation, link, groupName, household, choices, apiUtils]);

  const onChoiceChange = (member: string, value: string) => {
    setChoices((current) => ({
      ...current,
      [member]:
        'me' === value
          ? { kind: 'me' }
          : 'new' === value
            ? { kind: 'new', email: '' }
            : { kind: 'friend', email: value },
    }));
  };

  const currency = preview?.currency ?? 'EUR';
  const { toUIString } = getCurrencyHelpersCached(currency);

  return (
    <>
      <Head>
        <title>{t('tricount.title')}</title>
      </Head>
      <MainLayout
        title={
          <div className="flex items-center gap-1">
            <Button variant="ghost" size="icon" className="size-11" asChild>
              <Link href="/account" aria-label={t('navigation.account')}>
                <ChevronLeftIcon className="size-6" aria-hidden />
              </Link>
            </Button>
            <h1 className="text-xl font-semibold">{t('tricount.title')}</h1>
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
              <h2 className="text-lg font-semibold">{t('tricount.done_title')}</h2>
              <p className="text-muted-foreground text-sm">
                {t('tricount.done_body', { created: result.created, skipped: result.skipped })}
              </p>
              <Button asChild className="h-11">
                <Link href="/household">{t('tricount.go_household')}</Link>
              </Button>
            </section>
          ) : null}

          <section className="bg-card flex flex-col gap-3 rounded-xl border p-4">
            <label htmlFor={linkId} className="text-sm font-medium">
              {t('tricount.link_label')}
            </label>
            <p className="text-muted-foreground text-xs">{t('tricount.link_hint')}</p>
            <div className="flex gap-2">
              <Input
                id={linkId}
                value={link}
                onChange={(e) => setLink(e.target.value)}
                placeholder="https://tricount.com/…"
                className="h-11"
                inputMode="url"
                autoComplete="off"
              />
              <Button
                className="h-11 shrink-0"
                disabled={'' === link.trim() || previewMutation.isPending}
                onClick={() => {
                  loadPreview().catch(console.error);
                }}
              >
                {t('tricount.preview')}
              </Button>
            </div>
            {error ? (
              <p className="text-destructive text-sm" role="alert">
                {t(error)}
              </p>
            ) : null}
          </section>

          {preview && !result ? (
            <>
              <section className="bg-card rounded-xl border p-4">
                <h2 className="text-base font-semibold">{preview.title}</h2>
                <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
                  <dt className="text-muted-foreground">{t('tricount.expenses')}</dt>
                  <dd className="text-right tabular-nums">{preview.counts.normal}</dd>
                  <dt className="text-muted-foreground">{t('tricount.transfers')}</dt>
                  <dd className="text-right tabular-nums">{preview.counts.balance}</dd>
                  <dt className="text-muted-foreground">{t('tricount.incomes')}</dt>
                  <dd className="text-right tabular-nums">{preview.counts.income}</dd>
                  <dt className="text-muted-foreground">{t('tricount.total')}</dt>
                  <dd className="text-right font-semibold tabular-nums">
                    {toUIString(preview.total)}
                  </dd>
                  {preview.from && preview.to ? (
                    <>
                      <dt className="text-muted-foreground">{t('tricount.dates')}</dt>
                      <dd className="text-right">
                        {toUIDate(preview.from)} – {toUIDate(preview.to)}
                      </dd>
                    </>
                  ) : null}
                </dl>
                {0 < preview.alreadyImported && preview.existingGroup ? (
                  <p
                    className="bg-muted/60 text-muted-foreground mt-3 rounded-lg px-3 py-2 text-sm"
                    role="note"
                  >
                    {t('tricount.already_imported', {
                      count: preview.alreadyImported,
                      group: preview.existingGroup.name,
                    })}
                  </p>
                ) : null}
              </section>

              <section className="bg-card flex flex-col gap-4 rounded-xl border p-4">
                <div>
                  <h2 className="text-base font-semibold">{t('tricount.members_title')}</h2>
                  <p className="text-muted-foreground text-xs">{t('tricount.members_hint')}</p>
                </div>
                {preview.members.map((member) => {
                  const choice = choices[member] ?? { kind: 'new', email: '' };
                  const selectId = `member-${member}`;
                  return (
                    <div key={member} className="flex flex-col gap-2">
                      <label htmlFor={selectId} className="text-sm font-medium">
                        {member}
                      </label>
                      <NativeSelect
                        id={selectId}
                        className="h-11 w-full"
                        value={
                          'me' === choice.kind
                            ? 'me'
                            : 'friend' === choice.kind
                              ? choice.email
                              : 'new'
                        }
                        onChange={(e) => onChoiceChange(member, e.target.value)}
                      >
                        <NativeSelectOption value="me">{t('tricount.me')}</NativeSelectOption>
                        {friends.map((f) => (
                          <NativeSelectOption key={f.id} value={f.email}>
                            {f.name ?? f.email}
                          </NativeSelectOption>
                        ))}
                        <NativeSelectOption value="new">
                          {t('tricount.new_person')}
                        </NativeSelectOption>
                      </NativeSelect>
                      {'new' === choice.kind ? (
                        <Input
                          type="email"
                          aria-label={t('tricount.email_for', { name: member })}
                          placeholder={t('tricount.email_placeholder')}
                          value={choice.email}
                          onChange={(e) =>
                            setChoices((current) => ({
                              ...current,
                              [member]: { kind: 'new', email: e.target.value.trim() },
                            }))
                          }
                          className="h-11"
                        />
                      ) : null}
                    </div>
                  );
                })}
                {1 !== meCount ? (
                  <p className="text-destructive text-sm" role="alert">
                    {t('tricount.one_me')}
                  </p>
                ) : null}
              </section>

              <section className="bg-card flex flex-col gap-3 rounded-xl border p-4">
                {preview.existingGroup ? null : (
                  <>
                    <label htmlFor={groupNameId} className="text-sm font-medium">
                      {t('tricount.group_name')}
                    </label>
                    <Input
                      id={groupNameId}
                      value={groupName}
                      onChange={(e) => setGroupName(e.target.value)}
                      className="h-11"
                      maxLength={100}
                    />
                    <label className="flex min-h-11 cursor-pointer items-center gap-3 text-sm">
                      <Checkbox
                        checked={household}
                        onCheckedChange={(v) => setHousehold(true === v)}
                      />
                      {t('tricount.use_as_household')}
                    </label>
                  </>
                )}
                <Button
                  className="h-11"
                  disabled={!canImport || importMutation.isPending}
                  onClick={() => {
                    runImport().catch(console.error);
                  }}
                >
                  <DownloadIcon className="mr-2 size-4" aria-hidden />
                  {importMutation.isPending ? t('tricount.importing') : t('tricount.import')}
                </Button>
              </section>
            </>
          ) : null}
        </div>
      </MainLayout>
    </>
  );
};

ImportTricountPage.auth = true;

export const getStaticProps = withI18nStaticProps(['common']);

export default ImportTricountPage;
