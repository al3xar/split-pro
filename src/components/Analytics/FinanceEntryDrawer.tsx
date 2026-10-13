import { type FinanceEntry, type FinanceRecurrence } from '@prisma/client';
import { RepeatIcon, Trash2Icon } from 'lucide-react';
import React, { useCallback, useEffect, useId, useState } from 'react';
import { toast } from 'sonner';

import { getTimeZone, useIntlLocale } from '~/hooks/useMonthParam';
import { useTranslationWithUtils } from '~/hooks/useTranslationWithUtils';
import { type FinanceEntryKind } from '~/lib/analytics';
import { type CurrencyCode, isCurrencyCode } from '~/lib/currency';
import { FINANCE_CATEGORIES, FINANCE_ENTRY_KINDS } from '~/lib/finance';
import { cn } from '~/lib/utils';
import { api } from '~/utils/api';

import { CurrencyPicker } from '../AddExpense/CurrencyPicker';
import { formatMonth } from './MonthStepper';
import { DateSelector } from '../AddExpense/DateSelector';
import { SimpleConfirmationDialog } from '../SimpleConfirmationDialog';
import { Button } from '../ui/button';
import { CurrencyInput } from '../ui/currency-input';
import { AppDrawer } from '../ui/drawer';
import { Input } from '../ui/input';
import { NativeSelect, NativeSelectOption } from '../ui/native-select';

export interface FinanceEntryDraft {
  type: FinanceEntryKind;
  currency: string;
  date: Date;
  /** YYYY-MM shown on the page; first month of a new recurrence */
  month: string;
}

type Frequency = 'once' | 'monthly';

interface Props {
  draft: FinanceEntryDraft | null;
  /** Editing a single entry */
  entry?: FinanceEntry | null;
  /** Editing a recurrence template */
  recurrence?: FinanceRecurrence | null;
  onClose: () => void;
  onSaved: () => void;
}

const DAYS_OF_MONTH = Array.from({ length: 31 }, (_, i) => i + 1);

const ChoiceChips: React.FC<{
  label: string;
  options: readonly { value: string; label: string }[];
  value: string;
  onChange: (value: string) => void;
}> = ({ label, options, value, onChange }) => {
  const labelId = useId();
  return (
    <div className="flex flex-col gap-2">
      <span id={labelId} className="text-sm font-medium">
        {label}
      </span>
      <div role="radiogroup" aria-labelledby={labelId} className="flex flex-wrap gap-2">
        {options.map((option) => {
          const selected = option.value === value;
          return (
            <button
              key={option.value}
              type="button"
              role="radio"
              aria-checked={selected}
              onClick={() => onChange(option.value)}
              className={cn(
                'min-h-11 rounded-full border px-4 text-sm transition-colors',
                selected
                  ? 'border-primary bg-primary/15 text-foreground font-medium'
                  : 'text-muted-foreground hover:bg-muted',
              )}
            >
              {option.label}
            </button>
          );
        })}
      </div>
    </div>
  );
};

export const FinanceEntryDrawer: React.FC<Props> = ({
  draft,
  entry,
  recurrence,
  onClose,
  onSaved,
}) => {
  const { t, i18n, getCurrencyHelpersCached } = useTranslationWithUtils();
  const locale = useIntlLocale(i18n.language);
  const [frequency, setFrequency] = useState<Frequency>('once');
  const [dayOfMonth, setDayOfMonth] = useState(1);
  const [type, setType] = useState<FinanceEntryKind>('INCOME');
  const [currency, setCurrency] = useState<string>('EUR');
  const [amount, setAmount] = useState<bigint>(0n);
  const [amountStr, setAmountStr] = useState('');
  const [category, setCategory] = useState<string>('salary');
  const [description, setDescription] = useState('');
  const [date, setDate] = useState<Date>(new Date());
  const [showErrors, setShowErrors] = useState(false);
  const amountId = useId();
  const descriptionId = useId();
  const amountErrorId = useId();
  const dayId = useId();
  const dayHintId = useId();

  const createMutation = api.finance.create.useMutation();
  const updateMutation = api.finance.update.useMutation();
  const deleteMutation = api.finance.delete.useMutation();
  const createRecurrenceMutation = api.finance.createRecurrence.useMutation();
  const updateRecurrenceMutation = api.finance.updateRecurrence.useMutation();
  const stopRecurrenceMutation = api.finance.stopRecurrence.useMutation();

  const isNew = !entry && !recurrence;
  const isMonthly = Boolean(recurrence) || (isNew && 'monthly' === frequency);

  useEffect(() => {
    if (!draft) {
      return;
    }
    const source = entry ?? recurrence;
    const nextType = source?.type ?? draft.type;
    const nextCurrency = source?.currency ?? draft.currency;
    setType(nextType);
    setCurrency(nextCurrency);
    setAmount(source?.amount ?? 0n);
    setAmountStr(source ? getCurrencyHelpersCached(nextCurrency).toUIString(source.amount) : '');
    setCategory(source?.category ?? FINANCE_CATEGORIES[nextType][0] ?? 'other');
    setDescription(source?.description ?? '');
    setDate(entry?.date ?? draft.date);
    setFrequency('once');
    setDayOfMonth(recurrence?.dayOfMonth ?? draft.date.getDate());
    setShowErrors(false);
  }, [draft, entry, recurrence, getCurrencyHelpersCached]);

  const onTypeChange = useCallback((value: string) => {
    const nextType = value as FinanceEntryKind;
    setType(nextType);
    setCategory(FINANCE_CATEGORIES[nextType][0] ?? 'other');
  }, []);

  const onAmountChange = useCallback(
    ({ strValue, bigIntValue }: { strValue?: string; bigIntValue?: bigint }) => {
      if (undefined !== strValue) {
        setAmountStr(strValue);
      }
      if (undefined !== bigIntValue) {
        setAmount(bigIntValue);
      }
    },
    [],
  );

  const onCurrencyPick = useCallback((code: CurrencyCode | null) => {
    if (code) {
      setCurrency(code);
    }
  }, []);

  const onDateSelect = useCallback((value: Date | undefined) => {
    if (value) {
      setDate(new Date(value.getFullYear(), value.getMonth(), value.getDate(), 12));
    }
  }, []);

  const save = useCallback(async () => {
    if (0n >= amount) {
      setShowErrors(true);
      return;
    }
    const fields = { type, amount, currency, category, description: description.trim() };
    const timeZone = getTimeZone();
    try {
      if (recurrence) {
        await updateRecurrenceMutation.mutateAsync({
          id: recurrence.id,
          recurrence: { ...fields, dayOfMonth, startMonth: recurrence.startMonth },
          timeZone,
        });
      } else if (isMonthly && draft) {
        await createRecurrenceMutation.mutateAsync({
          recurrence: { ...fields, dayOfMonth, startMonth: draft.month },
          timeZone,
        });
      } else if (entry) {
        await updateMutation.mutateAsync({ id: entry.id, entry: { ...fields, date } });
      } else {
        await createMutation.mutateAsync({ ...fields, date });
      }
      toast.success(t('finance.saved'));
      onSaved();
      onClose();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('finance.error'));
    }
  }, [
    amount,
    type,
    currency,
    category,
    description,
    date,
    entry,
    recurrence,
    isMonthly,
    draft,
    dayOfMonth,
    updateMutation,
    createMutation,
    updateRecurrenceMutation,
    createRecurrenceMutation,
    t,
    onSaved,
    onClose,
  ]);

  const remove = useCallback(async () => {
    if (!entry) {
      return;
    }
    try {
      await deleteMutation.mutateAsync({ id: entry.id });
      toast.success(t('finance.deleted'));
      onSaved();
      onClose();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('finance.error'));
    }
  }, [entry, deleteMutation, t, onSaved, onClose]);

  const stop = useCallback(async () => {
    if (!recurrence) {
      return;
    }
    try {
      await stopRecurrenceMutation.mutateAsync({ id: recurrence.id });
      toast.success(t('finance.stopped'));
      onSaved();
      onClose();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('finance.error'));
    }
  }, [recurrence, stopRecurrenceMutation, t, onSaved, onClose]);

  const onDayChange = useCallback(
    (e: React.ChangeEvent<HTMLSelectElement>) => setDayOfMonth(Number(e.target.value)),
    [],
  );

  const onOpenChange = useCallback(
    (open: boolean) => {
      if (!open) {
        onClose();
      }
    },
    [onClose],
  );

  const amountInvalid = showErrors && 0n >= amount;
  const typeOptions = FINANCE_ENTRY_KINDS.map((kind) => ({
    value: kind,
    label: 'INCOME' === kind ? t('finance.income') : t('finance.investments'),
  }));
  const frequencyOptions = [
    { value: 'once', label: t('finance.once') },
    { value: 'monthly', label: t('finance.monthly') },
  ];
  const startMonth = recurrence?.startMonth ?? draft?.month;
  const categoryOptions = FINANCE_CATEGORIES[type].map((value) => ({
    value,
    label: t(`finance.categories.${type}.${value}`),
  }));

  return (
    <AppDrawer
      trigger={<span className="hidden" />}
      open={null !== draft}
      onOpenChange={onOpenChange}
      title={
        recurrence
          ? t('finance.edit_recurrence')
          : entry
            ? t('finance.edit_entry')
            : 'INCOME' === type
              ? t('finance.add_income')
              : t('finance.add_investment')
      }
      className="h-[85vh]"
      actionTitle={t('finance.save')}
      actionOnClick={save}
      actionDisabled={
        createMutation.isPending ||
        updateMutation.isPending ||
        createRecurrenceMutation.isPending ||
        updateRecurrenceMutation.isPending
      }
      leftAction={t('actions.cancel')}
      leftActionOnClick={onClose}
    >
      <form
        className="flex flex-col gap-5 px-1 pb-6"
        onSubmit={(e) => {
          e.preventDefault();
          save().catch(console.error);
        }}
      >
        {recurrence ? null : (
          <ChoiceChips
            label={t('finance.type')}
            options={typeOptions}
            value={type}
            onChange={onTypeChange}
          />
        )}

        {isNew ? (
          <ChoiceChips
            label={t('finance.frequency')}
            options={frequencyOptions}
            value={frequency}
            onChange={(value) => setFrequency(value as Frequency)}
          />
        ) : null}

        <div className="flex flex-col gap-2">
          <label htmlFor={amountId} className="text-sm font-medium">
            {t('finance.amount')}
          </label>
          <div className="flex items-center gap-2">
            <CurrencyPicker
              currentCurrency={isCurrencyCode(currency) ? currency : null}
              onCurrencyPick={onCurrencyPick}
            />
            <CurrencyInput
              id={amountId}
              currency={currency}
              strValue={amountStr}
              onValueChange={onAmountChange}
              className="h-11 text-lg"
              aria-invalid={amountInvalid}
              aria-describedby={amountInvalid ? amountErrorId : undefined}
              autoFocus={isNew}
            />
          </div>
          {amountInvalid ? (
            <p id={amountErrorId} className="text-destructive text-sm" role="alert">
              {t('finance.amount_required')}
            </p>
          ) : null}
        </div>

        <ChoiceChips
          label={t('finance.category')}
          options={categoryOptions}
          value={category}
          onChange={setCategory}
        />

        <div className="flex flex-col gap-2">
          <label htmlFor={descriptionId} className="text-sm font-medium">
            {t('finance.description')}
          </label>
          <Input
            id={descriptionId}
            value={description}
            maxLength={200}
            placeholder={t(
              'INCOME' === type
                ? 'finance.description_placeholder'
                : 'finance.description_placeholder_investment',
            )}
            onChange={(e) => setDescription(e.target.value)}
            className="h-11"
          />
        </div>

        {isMonthly ? (
          <div className="flex flex-col gap-2">
            <label htmlFor={dayId} className="text-sm font-medium">
              {t('finance.pay_day')}
            </label>
            <NativeSelect
              id={dayId}
              value={dayOfMonth}
              onChange={onDayChange}
              className="h-11 w-32"
              aria-describedby={dayHintId}
            >
              {DAYS_OF_MONTH.map((day) => (
                <NativeSelectOption key={day} value={day}>
                  {t('finance.pay_day_option', { day })}
                </NativeSelectOption>
              ))}
            </NativeSelect>
            <p id={dayHintId} className="text-muted-foreground flex gap-2 text-xs">
              <RepeatIcon className="mt-0.5 size-3.5 shrink-0" aria-hidden />
              <span>
                {recurrence
                  ? t('finance.recurring_edit_hint')
                  : t('finance.recurring_hint', {
                      day: dayOfMonth,
                      month: startMonth ? formatMonth(startMonth, locale) : '',
                    })}
                {28 < dayOfMonth ? ` ${t('finance.recurring_short_months')}` : ''}
              </span>
            </p>
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            <span className="text-sm font-medium">{t('finance.date')}</span>
            <DateSelector mode="single" required selected={date} onSelect={onDateSelect} />
          </div>
        )}

        <button type="submit" className="sr-only">
          {t('finance.save')}
        </button>

        {entry ? (
          <SimpleConfirmationDialog
            title={t('finance.delete_title')}
            description={t('finance.delete_description')}
            hasPermission
            loading={deleteMutation.isPending}
            variant="destructive"
            onConfirm={remove}
          >
            <Button type="button" variant="ghost" className="text-destructive h-11 self-start">
              <Trash2Icon className="mr-2 size-4" aria-hidden />
              {t('finance.delete')}
            </Button>
          </SimpleConfirmationDialog>
        ) : null}

        {recurrence ? (
          <SimpleConfirmationDialog
            title={t('finance.stop_title')}
            description={t('finance.stop_description')}
            hasPermission
            loading={stopRecurrenceMutation.isPending}
            variant="destructive"
            onConfirm={stop}
          >
            <Button type="button" variant="ghost" className="text-destructive h-11 self-start">
              <RepeatIcon className="mr-2 size-4" aria-hidden />
              {t('finance.stop_recurrence')}
            </Button>
          </SimpleConfirmationDialog>
        ) : null}
      </form>
    </AppDrawer>
  );
};
