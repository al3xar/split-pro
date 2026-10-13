import { CheckCircle2Icon, ChevronLeftIcon, PlugZapIcon, XCircleIcon } from 'lucide-react';
import Head from 'next/head';
import Link from 'next/link';
import React, { useEffect, useId, useState } from 'react';
import { toast } from 'sonner';

import MainLayout from '~/components/Layout/MainLayout';
import { Button } from '~/components/ui/button';
import { Input } from '~/components/ui/input';
import { useTranslationWithUtils } from '~/hooks/useTranslationWithUtils';
import { type NextPageWithUser } from '~/types';
import { type RouterOutputs, api } from '~/utils/api';
import { withI18nStaticProps } from '~/utils/i18n/server';

type TestResult = RouterOutputs['assistant']['testSettings'];

const AssistantSettingsPage: NextPageWithUser = () => {
  const { t } = useTranslationWithUtils();
  const ids = { url: useId(), model: useId(), key: useId(), steps: useId(), models: useId() };
  const settingsQuery = api.assistant.settings.useQuery();
  const saveMutation = api.assistant.saveSettings.useMutation();
  const resetMutation = api.assistant.resetSettings.useMutation();
  const testMutation = api.assistant.testSettings.useMutation();
  const apiUtils = api.useUtils();

  const [baseUrl, setBaseUrl] = useState('');
  const [model, setModel] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [removeKey, setRemoveKey] = useState(false);
  const [maxSteps, setMaxSteps] = useState(5);
  const [test, setTest] = useState<TestResult | null>(null);

  useEffect(() => {
    if (settingsQuery.data) {
      setBaseUrl(settingsQuery.data.baseUrl);
      setModel(settingsQuery.data.model);
      setMaxSteps(settingsQuery.data.maxSteps);
      setApiKey('');
      setRemoveKey(false);
    }
  }, [settingsQuery.data]);

  const data = settingsQuery.data;
  const urlValid = /^https?:\/\/\S+$/.test(baseUrl.trim());

  const save = async () => {
    try {
      await saveMutation.mutateAsync({
        baseUrl: baseUrl.trim(),
        model: model.trim(),
        apiKey: removeKey ? null : apiKey ? apiKey : undefined,
        maxSteps,
      });
      toast.success(t('assistant_settings.saved'));
      await apiUtils.assistant.invalidate();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('assistant_settings.error'));
    }
  };

  const runTest = async () => {
    setTest(null);
    try {
      setTest(
        await testMutation.mutateAsync({
          baseUrl: baseUrl.trim(),
          model: model.trim(),
          apiKey: apiKey || undefined,
        }),
      );
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('assistant_settings.error'));
    }
  };

  const reset = async () => {
    await resetMutation.mutateAsync();
    setTest(null);
    toast.success(t('assistant_settings.reset_done'));
    await apiUtils.assistant.invalidate();
  };

  return (
    <>
      <Head>
        <title>{t('assistant_settings.title')}</title>
      </Head>
      <MainLayout
        title={
          <div className="flex items-center gap-1">
            <Button variant="ghost" size="icon" className="size-11" asChild>
              <Link href="/assistant" aria-label={t('assistant.title')}>
                <ChevronLeftIcon className="size-6" aria-hidden />
              </Link>
            </Button>
            <h1 className="text-xl font-semibold">{t('assistant_settings.title')}</h1>
          </div>
        }
        loading={settingsQuery.isPending}
      >
        <form
          className="flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            void save();
          }}
        >
          <p className="text-muted-foreground text-sm">{t('assistant_settings.intro')}</p>
          {data && 'env' === data.source && data.enabled ? (
            <p
              className="bg-muted/60 text-muted-foreground rounded-lg px-3 py-2 text-sm"
              role="note"
            >
              {t('assistant_settings.from_env')}
            </p>
          ) : null}

          <section className="bg-card flex flex-col gap-4 rounded-xl border p-4">
            <div className="flex flex-col gap-1">
              <label htmlFor={ids.url} className="text-sm font-medium">
                {t('assistant_settings.base_url')}
              </label>
              <Input
                id={ids.url}
                value={baseUrl}
                onChange={(e) => setBaseUrl(e.target.value)}
                placeholder="https://vllm.example.com/v1"
                inputMode="url"
                autoComplete="off"
                className="h-11"
                aria-invalid={'' !== baseUrl && !urlValid}
              />
              <p className="text-muted-foreground text-xs">
                {t('assistant_settings.base_url_hint')}
              </p>
            </div>

            <div className="flex flex-col gap-1">
              <label htmlFor={ids.model} className="text-sm font-medium">
                {t('assistant_settings.model')}
              </label>
              <Input
                id={ids.model}
                value={model}
                onChange={(e) => setModel(e.target.value)}
                placeholder="Qwen/Qwen2.5-14B-Instruct"
                autoComplete="off"
                className="h-11"
                list={ids.models}
              />
              <datalist id={ids.models}>
                {(test?.models ?? []).map((m) => (
                  <option key={m} value={m} />
                ))}
              </datalist>
            </div>

            <div className="flex flex-col gap-1">
              <label htmlFor={ids.key} className="text-sm font-medium">
                {t('assistant_settings.api_key')}
              </label>
              <Input
                id={ids.key}
                type="password"
                value={apiKey}
                onChange={(e) => {
                  setApiKey(e.target.value);
                  setRemoveKey(false);
                }}
                placeholder={
                  data?.hasApiKey && !removeKey
                    ? t('assistant_settings.api_key_set', { hint: data.apiKeyHint })
                    : t('assistant_settings.api_key_placeholder')
                }
                autoComplete="new-password"
                className="h-11"
              />
              <div className="flex items-center justify-between gap-2">
                <p className="text-muted-foreground text-xs">
                  {t('assistant_settings.api_key_hint')}
                </p>
                {data?.hasApiKey && !removeKey ? (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-9"
                    onClick={() => setRemoveKey(true)}
                  >
                    {t('assistant_settings.remove_key')}
                  </Button>
                ) : null}
              </div>
            </div>

            <div className="flex flex-col gap-1">
              <label htmlFor={ids.steps} className="text-sm font-medium">
                {t('assistant_settings.max_steps')}
              </label>
              <Input
                id={ids.steps}
                type="number"
                min={1}
                max={10}
                value={maxSteps}
                onChange={(e) =>
                  setMaxSteps(Math.min(10, Math.max(1, Number(e.target.value) || 1)))
                }
                className="h-11 w-28"
              />
            </div>
          </section>

          {test ? (
            <section
              role="status"
              className={
                test.ok
                  ? 'border-positive/40 bg-positive/10 flex gap-3 rounded-xl border p-4 text-sm'
                  : 'border-destructive/40 bg-destructive/10 flex gap-3 rounded-xl border p-4 text-sm'
              }
            >
              {test.ok ? (
                <CheckCircle2Icon className="text-positive size-5 shrink-0" aria-hidden />
              ) : (
                <XCircleIcon className="text-destructive size-5 shrink-0" aria-hidden />
              )}
              <div>
                <p className="font-medium">
                  {test.ok
                    ? t('assistant_settings.test_ok', { count: test.models.length })
                    : t(
                        `assistant_settings.test_errors.${test.error?.startsWith('HTTP_401') || test.error?.startsWith('HTTP_403') ? 'auth' : 'TIMEOUT' === test.error ? 'timeout' : 'DNS' === test.error ? 'dns' : 'UNREACHABLE' === test.error ? 'unreachable' : 'http'}`,
                        { code: test.error },
                      )}
                </p>
                {test.ok && false === test.modelFound ? (
                  <p className="mt-1">{t('assistant_settings.model_missing')}</p>
                ) : null}
              </div>
            </section>
          ) : null}

          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="secondary"
              className="h-11"
              disabled={!urlValid || testMutation.isPending}
              onClick={() => void runTest()}
            >
              <PlugZapIcon className="mr-2 size-4" aria-hidden />
              {testMutation.isPending
                ? t('assistant_settings.testing')
                : t('assistant_settings.test')}
            </Button>
            <Button
              type="submit"
              className="h-11"
              disabled={('' !== baseUrl && !urlValid) || saveMutation.isPending}
            >
              {t('assistant_settings.save')}
            </Button>
            {data && 'ui' === data.source ? (
              <Button type="button" variant="ghost" className="h-11" onClick={() => void reset()}>
                {t('assistant_settings.reset')}
              </Button>
            ) : null}
          </div>
        </form>
      </MainLayout>
    </>
  );
};

AssistantSettingsPage.auth = true;

export const getStaticProps = withI18nStaticProps(['common']);

export default AssistantSettingsPage;
