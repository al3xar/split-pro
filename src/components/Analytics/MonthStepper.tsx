import { ChevronLeftIcon, ChevronRightIcon } from 'lucide-react';
import { useTranslation } from 'next-i18next';
import React, { useCallback, useMemo } from 'react';

import { shiftMonth } from '~/lib/analytics';
import { useIntlLocale } from '~/hooks/useMonthParam';

import { Button } from '../ui/button';

export const formatMonth = (
  month: string,
  locale: string | undefined,
  options: Intl.DateTimeFormatOptions = { month: 'long', year: 'numeric' },
) => {
  const [year, monthNumber] = month.split('-').map(Number) as [number, number];
  return new Intl.DateTimeFormat(locale, options).format(new Date(year, monthNumber - 1, 1));
};

export const MonthStepper: React.FC<{
  month: string;
  onChange: (month: string) => void;
  maxMonth?: string;
}> = ({ month, onChange, maxMonth }) => {
  const { t, i18n } = useTranslation();
  const locale = useIntlLocale(i18n.language);
  const label = useMemo(() => formatMonth(month, locale), [month, locale]);
  const isLast = undefined !== maxMonth && month >= maxMonth;

  const previous = useCallback(() => onChange(shiftMonth(month, -1)), [month, onChange]);
  const next = useCallback(() => onChange(shiftMonth(month, 1)), [month, onChange]);

  return (
    <div className="flex items-center gap-1" role="group" aria-label={label}>
      <Button
        variant="ghost"
        size="icon"
        className="size-11"
        onClick={previous}
        aria-label={t('analytics.month_previous')}
      >
        <ChevronLeftIcon className="size-5" aria-hidden />
      </Button>
      <p
        className="min-w-[9.5rem] text-center text-base font-medium first-letter:uppercase"
        aria-live="polite"
      >
        {label}
      </p>
      <Button
        variant="ghost"
        size="icon"
        className="size-11"
        onClick={next}
        disabled={isLast}
        aria-label={t('analytics.month_next')}
      >
        <ChevronRightIcon className="size-5" aria-hidden />
      </Button>
    </div>
  );
};
