import { useRouter } from 'next/router';
import { useCallback, useMemo } from 'react';

import { monthKey } from '~/lib/analytics';

const MONTH_REGEX = /^\d{4}-(0[1-9]|1[0-2])$/;

export const getTimeZone = () => Intl.DateTimeFormat().resolvedOptions().timeZone;

/** Selected month (YYYY-MM) kept in the `?month=` query so a refresh keeps it. */
export const useMonthParam = () => {
  const router = useRouter();
  const timeZone = useMemo(getTimeZone, []);
  const currentMonth = useMemo(() => monthKey(new Date(), timeZone), [timeZone]);

  const queryMonth = router.query.month;
  const month =
    'string' === typeof queryMonth && MONTH_REGEX.test(queryMonth) ? queryMonth : currentMonth;

  const setMonth = useCallback(
    (next: string) => {
      const { month: _previous, ...rest } = router.query;
      const query = next === currentMonth ? rest : { ...rest, month: next };
      router
        .replace({ pathname: router.pathname, query }, undefined, { shallow: true })
        .catch(console.error);
    },
    [router, currentMonth],
  );

  return { month, setMonth, currentMonth, timeZone, isReady: router.isReady };
};

export const useIntlLocale = (language: string) => ('default' === language ? undefined : language);
